"""ProInk Bridge — a local socket between the ProInk studio and this Blender file.

Install (Blender 4.2 or newer, including 5.x):

1. Edit → Preferences → Add-ons → Install from Disk…
2. Choose this file, ``proink_bridge.py``.
3. Enable **ProInk Bridge**. If the list hides legacy add-ons, switch the
   add-on filter so legacy add-ons are shown, then enable it.
4. In the 3D Viewport press N and open the **ProInk** tab. The bridge starts
   on its own; Start / Stop are there if you need them.

The server binds to 127.0.0.1 only (port 9876 unless the add-on preference
says otherwise). ``exec`` runs Python that the studio on this machine sends.
Do not forward the port, and do not enable the add-on on a computer you do
not trust with that studio.

Messages are already in Blender meters and Blender axes. This add-on does
not convert them. The ``proink.mm`` / ``proink.size`` helpers are only for
scripts run through ``exec``.
"""

bl_info = {
    "name": "ProInk Bridge",
    "author": "ProInk",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > ProInk",
    "description": "Local bridge so the ProInk studio can read and write this file",
    "category": "System",
}

import base64
import contextlib
import io
import json
import math
import os
import queue
import re
import secrets
import shutil
import socket
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import bpy
    import mathutils
    from mathutils import Quaternion, Vector
except ImportError:  # pragma: no cover - exercised only outside Blender
    bpy = None
    mathutils = None
    Quaternion = None
    Vector = None

HOST = "127.0.0.1"
DEFAULT_PORT = 9876
MAX_BODY = 200 * 1024 * 1024
QUEUE_WAIT = 180.0
TIMER_INTERVAL = 0.05
OUTPUT_LIMIT = 20000
ERROR_LIMIT = 4000
RENDER_MIN = 256
RENDER_MAX = 1600
COLLECTION_STUDIO = "ProInk"
COLLECTION_BOOTH = "ProInk booth"
SOURCES = ("studio", "blender", "booth")
GEOMETRY_TYPES = {"MESH", "CURVE", "SURFACE", "META", "FONT"}
_ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789"
TIMEOUT_ERROR = "Blender did not answer in time"
UNKNOWN_COMMAND = "Unknown command"
UNSAVED_ERROR = (
    "Save the Blender file once (File > Save As) so the drawing has a place on disk."
)
STOPPING_ERROR = "ProInk Bridge is stopping"
VIEW_OFFSETS = {
    "front": (0.0, -1.0, 0.0),
    "side": (1.0, 0.0, 0.0),
    "top": (0.0, 0.0, 1.0),
}

# bpy is only touched on Blender's main thread. HTTP threads enqueue work.
_queue = queue.Queue()
_lock = threading.Lock()
_inflight = []
_httpd = None
_thread = None
_alive = False
_units_set = False
_state = {"port": DEFAULT_PORT, "error": ""}


def srgb_to_linear(channel):
    """Convert one sRGB channel in 0..1 to a linear channel."""
    try:
        c = float(channel)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(c):
        return 0.0
    if c < 0.0:
        c = 0.0
    elif c > 1.0:
        c = 1.0
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def parse_hex(color):
    """Return (r, g, b) in 0..1 sRGB from a hex string, or None."""
    if not isinstance(color, str):
        return None
    text = color.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    elif len(text) == 4:
        text = "".join(ch * 2 for ch in text[:3])
    elif len(text) == 8:
        text = text[:6]
    if len(text) != 6:
        return None
    try:
        value = int(text, 16)
    except ValueError:
        return None
    return (
        ((value >> 16) & 255) / 255.0,
        ((value >> 8) & 255) / 255.0,
        (value & 255) / 255.0,
    )


def unit_float(value, default):
    """Clamp a JSON number to 0..1, or return ``default`` when it is unusable."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    if number < 0.0:
        return 0.0
    if number > 1.0:
        return 1.0
    return number


def r6(value):
    """Round a float to 6 decimal places. Non-finite values become 0."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(number):
        return 0.0
    return float(f"{number:.6f}")


def as_bool(value, default=False):
    """Read a JSON flag. The string ``\"false\"`` is false (unlike ``bool(str)``)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return bool(value) if math.isfinite(float(value)) else default
    if isinstance(value, str):
        text = value.strip().lower()
        if text in ("1", "true", "yes", "on"):
            return True
        if text in ("0", "false", "no", "off", ""):
            return False
    if value is None:
        return default
    return default


def slug_name(name):
    """Lowercase slug: non-alphanumeric runs become '-', trimmed, at most 40 chars."""
    text = re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-")
    text = text[:40].strip("-")
    return text or "piece"


def make_id(name, taken):
    """Return ``<slug>-<4 lowercase alnum>`` and record it in ``taken``."""
    base = slug_name(name)
    for length in (4, 8):
        for _ in range(32 if length == 4 else 8):
            suffix = "".join(secrets.choice(_ALNUM) for _ in range(length))
            candidate = f"{base}-{suffix}"
            if candidate not in taken:
                taken.add(candidate)
                return candidate
    suffix = "".join(secrets.choice(_ALNUM) for _ in range(12))
    candidate = f"{base}-{suffix}"
    taken.add(candidate)
    return candidate


def studio_mm(x, y, z):
    """Studio millimeters (X right, Y up, Z toward the viewer) to Blender meters."""
    return (float(x) / 1000.0, -float(z) / 1000.0, float(y) / 1000.0)


def studio_size(width, height, depth):
    """Studio millimeters (width, height, depth) to a Blender (X, Y, Z) size."""
    return (float(width) / 1000.0, float(depth) / 1000.0, float(height) / 1000.0)


def tag_string(tag):
    """Store ``proink_tag`` as text. Dicts are serialized; anything else is a string."""
    if tag is None:
        return ""
    if isinstance(tag, str):
        return tag
    try:
        return json.dumps(tag, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(tag)


def wants_smooth(tag):
    """True when the tag JSON has shape 'cylinder' or 'tube'."""
    if isinstance(tag, str):
        if not tag:
            return False
        try:
            data = json.loads(tag)
        except (json.JSONDecodeError, TypeError, ValueError):
            return False
    elif isinstance(tag, dict):
        data = tag
    else:
        return False
    if not isinstance(data, dict):
        return False
    shape = data.get("shape")
    if not isinstance(shape, str):
        return False
    return shape.strip().lower() in ("cylinder", "tube")


def tag_payload(name, material, kind, item, material_id, color):
    """JSON object for ``proink.tag``. Keys with a None value are left out."""
    data = {}
    if name is not None:
        data["name"] = name
    if material is not None:
        data["material"] = material
    if kind is not None:
        data["kind"] = kind
    if item is not None:
        data["item"] = item
    if material_id is not None:
        data["materialId"] = material_id
    if color is not None:
        data["color"] = color
    return data


def grouped_vectors(values):
    """Flat ``[x, y, z, ...]`` to a list of xyz tuples. None if a value is not a finite float."""
    if values is None or isinstance(values, (str, bytes)):
        return None
    try:
        nums = [float(v) for v in values]
    except (TypeError, ValueError):
        return None
    if any(not math.isfinite(number) for number in nums):
        return None
    count = len(nums) // 3
    return [tuple(nums[i : i + 3]) for i in range(0, count * 3, 3)]


def triangle_faces(vertex_count, indices):
    """Triangles as index triples. ``indices is None`` means consecutive triples."""
    if vertex_count <= 0:
        return []
    if indices is None:
        return [(i, i + 1, i + 2) for i in range(0, vertex_count - 2, 3)]
    if isinstance(indices, (str, bytes)):
        return []
    try:
        raw = list(indices)
    except TypeError:
        return []
    faces = []
    for start in range(0, len(raw) - 2, 3):
        try:
            a = int(raw[start])
            b = int(raw[start + 1])
            c = int(raw[start + 2])
        except (TypeError, ValueError):
            continue
        if 0 <= a < vertex_count and 0 <= b < vertex_count and 0 <= c < vertex_count:
            faces.append((a, b, c))
    return faces


def mesh_signature(vert_count, tri_count, coords):
    """``verts:tris:`` plus the local bbox rounded to 0.1 mm (``round(meters * 10000)``)."""
    minx = miny = minz = math.inf
    maxx = maxy = maxz = -math.inf
    count = 0
    for co in coords:
        x = float(co[0])
        y = float(co[1])
        z = float(co[2])
        if x < minx:
            minx = x
        if y < miny:
            miny = y
        if z < minz:
            minz = z
        if x > maxx:
            maxx = x
        if y > maxy:
            maxy = y
        if z > maxz:
            maxz = z
        count += 1
    if count == 0:
        parts = (0, 0, 0, 0, 0, 0)
    else:
        parts = tuple(int(round(v * 10000.0)) for v in (minx, miny, minz, maxx, maxy, maxz))
    bbox = ",".join(str(part) for part in parts)
    return f"{int(vert_count)}:{int(tri_count)}:{bbox}"


def fit_ortho_scale(proj_w, proj_h, res_x, res_y):
    """Orthographic width that frames both projected extents in a landscape render.

    With sensor fit HORIZONTAL, ``ortho_scale`` is the view width and the view
    height is ``ortho_scale * res_y / res_x``. The 4:3 frame is shorter than it
    is wide, so the vertical extent is scaled up before the 1.15 margin.
    """
    height = res_y or 1
    aspect = float(res_x) / float(height)
    scale = 1.15 * max(float(proj_w), float(proj_h) * aspect)
    if not math.isfinite(scale) or scale < 1e-6:
        return 1.0
    return scale


def iso_offset():
    """Unit offset of the iso camera from the bbox center: ``normalize(1, -1.2, 0.9)``."""
    x, y, z = 1.0, -1.2, 0.9
    length = math.sqrt(x * x + y * y + z * z)
    return (x / length, y / length, z / length)


def clamp_size(size):
    """Render width clamped to 256..1600. Unusable input becomes 256."""
    try:
        number = int(size)
    except (TypeError, ValueError):
        return RENDER_MIN
    if number < RENDER_MIN:
        return RENDER_MIN
    if number > RENDER_MAX:
        return RENDER_MAX
    return number


def _limited_output():
    """StringIO that stops storing after OUTPUT_LIMIT characters."""

    class _Limited(io.TextIOBase):
        def __init__(self):
            super().__init__()
            self._parts = []
            self._count = 0

        def write(self, text):
            chunk = str(text)
            room = OUTPUT_LIMIT - self._count
            if room > 0:
                piece = chunk[:room]
                self._parts.append(piece)
                self._count += len(piece)
            return len(chunk)

        def getvalue(self):
            return "".join(self._parts)

    return _Limited()


def _tail(text, limit):
    text = text or ""
    if len(text) <= limit:
        return text
    return text[-limit:]


if bpy is not None:

    class ProInkHelpers:
        """Helpers for Python the ProInk studio runs inside Blender.

        Studio space is millimeters: X right, Y up, Z toward the viewer, origin
        at the back-left floor corner. Blender is meters, Z up, and the viewer
        looks toward +Y. Synced meshes are already in Blender units.
        """

        def mm(self, x, y, z):
            """Return a Blender Vector for a point given in studio millimeters.

            ``x``, ``y``, and ``z`` are studio millimeters (X right, Y up, Z
            toward the viewer). The result is meters: X stays X, studio Y
            becomes Blender Z, and studio Z becomes negative Blender Y.
            """
            return Vector(studio_mm(x, y, z))

        def size(self, width, height, depth):
            """Return a Blender Vector for a studio size in millimeters.

            Width maps to X, depth to Y, and height to Z. Each value is divided
            by 1000 so the result is in meters.
            """
            return Vector(studio_size(width, height, depth))

        def collection(self):
            """Return the 'ProInk' collection, creating it under the scene if needed."""
            return ensure_collection(COLLECTION_STUDIO)

        def tag(self, obj, name=None, material=None, kind="built", item=None, material_id=None, color=None):
            """Mark ``obj`` as a free-form priced piece and return it.

            Sets ``proink_source`` to ``blender``, assigns ``proink_id`` when
            the object does not have one, and stores ``proink_tag`` as JSON of
            the fields that are not None: name, material, kind, item,
            materialId, and color. ``name`` defaults to the object name. When
            ``name`` is given it is also assigned to ``obj.name``. ``kind``
            defaults to ``built``.
            """
            if name is not None:
                obj.name = str(name)
            stored_name = str(name) if name is not None else obj.name
            payload = tag_payload(stored_name, material, kind, item, material_id, color)
            obj["proink_tag"] = json.dumps(payload, ensure_ascii=False)
            obj["proink_source"] = "blender"
            if not prop_str(obj, "proink_id"):
                taken = taken_ids()
                obj["proink_id"] = make_id(obj.name, taken)
            return obj

        def pieces(self):
            """Return every object that has a ``proink_id``, sorted by name."""
            found = [obj for obj in bpy.data.objects if prop_str(obj, "proink_id")]
            found.sort(key=lambda obj: obj.name)
            return found

        def piece(self, id):
            """Return the object with this ``proink_id``, or None.

            When a duplicated id is still shared, the first object in name
            order is returned.
            """
            want = str(id)
            matches = [obj for obj in bpy.data.objects if prop_str(obj, "proink_id") == want]
            if not matches:
                return None
            matches.sort(key=lambda obj: obj.name)
            return matches[0]

    PROINK = ProInkHelpers()

    def prop_str(obj, key):
        try:
            value = obj.get(key)
        except Exception:
            return ""
        if value is None:
            return ""
        return str(value)

    def taken_ids():
        taken = set()
        for obj in bpy.data.objects:
            pid = prop_str(obj, "proink_id")
            if pid:
                taken.add(pid)
        return taken

    def count_proink_objects():
        try:
            objects = bpy.data.objects
        except Exception:
            return 0
        return sum(1 for obj in objects if prop_str(obj, "proink_id"))

    def in_booth(obj):
        """True when the object is linked directly into a collection named 'ProInk booth'."""
        try:
            collections = obj.users_collection
        except Exception:
            return False
        return any(col.name == COLLECTION_BOOTH for col in collections)

    def ensure_collection(name):
        scene_root = bpy.context.scene.collection
        existing = bpy.data.collections.get(name)
        if existing is None:
            existing = bpy.data.collections.new(name)

        def walk(col):
            yield col
            for child in col.children:
                yield from walk(child)

        if not any(col == existing for col in walk(scene_root)):
            scene_root.children.link(existing)
        return existing

    def link_object(obj, collection):
        try:
            if obj.name not in collection.objects:
                collection.objects.link(obj)
        except RuntimeError:
            pass

    def remove_datablock(obj_type, data):
        if data is None or getattr(data, "users", 1) != 0:
            return
        banks = {
            "MESH": bpy.data.meshes,
            "CURVE": bpy.data.curves,
            "SURFACE": bpy.data.curves,
            "FONT": bpy.data.curves,
            "META": bpy.data.metaballs,
        }
        bank = banks.get(obj_type)
        if bank is None:
            return
        try:
            bank.remove(data)
        except Exception:
            pass

    def remove_object(obj):
        obj_type = obj.type
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        remove_datablock(obj_type, data)

    # hide_set needs the object in the view layer. New and relinked objects
    # only get there after view_layer.update, so the call is repeated then.
    _pending_hide = []

    def set_hidden(obj, hidden):
        hidden = bool(hidden)
        obj.hide_viewport = hidden
        obj.hide_render = hidden
        _pending_hide.append((obj, hidden))
        apply_hide_set(obj, hidden)

    def apply_hide_set(obj, hidden):
        try:
            obj.hide_set(hidden, view_layer=bpy.context.view_layer)
        except Exception:
            try:
                obj.hide_set(hidden)
            except Exception:
                pass

    def flush_hide():
        pending = list(_pending_hide)
        _pending_hide.clear()
        for obj, hidden in pending:
            apply_hide_set(obj, hidden)

    def set_socket(node, name, value):
        try:
            socket_in = node.inputs.get(name)
        except Exception:
            return
        if socket_in is None:
            return
        try:
            socket_in.default_value = value
        except Exception:
            pass

    def set_blend(mat, transparent):
        # 4.2+ EEVEE uses surface_render_method. Older files still have blend_method.
        if transparent:
            try:
                mat.surface_render_method = "BLENDED"
                return
            except Exception:
                pass
            try:
                mat.blend_method = "BLEND"
            except Exception:
                pass
            return
        try:
            mat.surface_render_method = "DITHERED"
            return
        except Exception:
            pass
        try:
            mat.blend_method = "OPAQUE"
        except Exception:
            pass

    def ensure_material(spec):
        if not isinstance(spec, dict):
            spec = {}
        name = spec.get("name") or "ProInk"
        name = str(name) or "ProInk"
        mat = bpy.data.materials.get(name)
        if mat is None:
            mat = bpy.data.materials.new(name)
        try:
            mat.use_nodes = True
        except Exception:
            pass
        color = parse_hex(spec.get("color") if isinstance(spec.get("color"), str) else "")
        if color is None:
            color = parse_hex("#CCCCCC")
        linear = tuple(srgb_to_linear(channel) for channel in color)
        alpha = unit_float(spec.get("alpha", 1.0), 1.0)
        metal = unit_float(spec.get("metalness", 0.0), 0.0)
        rough = unit_float(spec.get("roughness", 0.5), 0.5)
        tree = getattr(mat, "node_tree", None)
        bsdf = None
        if tree is not None:
            bsdf = next((node for node in tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None:
                try:
                    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
                except Exception:
                    bsdf = None
        if bsdf is not None:
            set_socket(bsdf, "Base Color", (linear[0], linear[1], linear[2], 1.0))
            set_socket(bsdf, "Metallic", metal)
            set_socket(bsdf, "Roughness", rough)
            set_socket(bsdf, "Alpha", alpha)
        try:
            mat.diffuse_color = (linear[0], linear[1], linear[2], alpha)
        except Exception:
            pass
        try:
            mat.metallic = metal
        except Exception:
            pass
        try:
            mat.roughness = rough
        except Exception:
            pass
        set_blend(mat, alpha < 1.0)
        return mat

    def assign_material(obj, mat):
        data = getattr(obj, "data", None)
        if data is not None and hasattr(data, "materials"):
            mats = data.materials
            if len(mats) == 0:
                mats.append(mat)
            else:
                mats[0] = mat
            return
        try:
            slots = obj.material_slots
        except Exception:
            return
        if len(slots) > 0:
            slots[0].material = mat

    def shade_mesh(mesh, smooth):
        polygons = mesh.polygons
        if len(polygons) == 0:
            return
        flag = bool(smooth)
        try:
            polygons.foreach_set("use_smooth", [flag] * len(polygons))
        except Exception:
            for poly in polygons:
                poly.use_smooth = flag
        try:
            if flag and hasattr(mesh, "shade_smooth"):
                mesh.shade_smooth()
            elif (not flag) and hasattr(mesh, "shade_flat"):
                mesh.shade_flat()
        except Exception:
            pass

    def build_mesh(name, positions, indices, smooth):
        verts = grouped_vectors(positions)
        if verts is None:
            raise ValueError("positions are not finite numbers")
        faces = triangle_faces(len(verts), indices)
        mesh = bpy.data.meshes.new(name or "ProInk")
        try:
            mesh.from_pydata(verts, [], faces)
            mesh.update(calc_edges=True)
            try:
                mesh.validate(verbose=False)
            except TypeError:
                mesh.validate()
            shade_mesh(mesh, smooth)
        except Exception:
            bpy.data.meshes.remove(mesh)
            raise
        return mesh

    def purge_meshes(meshes):
        for mesh in meshes:
            try:
                if mesh.users == 0:
                    bpy.data.meshes.remove(mesh)
            except Exception:
                pass


    def swap_mesh(obj, mesh, collection, name, retired):
        if obj.type != "MESH":
            remove_object(obj)
            created = bpy.data.objects.new(name, mesh)
            link_object(created, collection)
            return created
        old = obj.data
        try:
            obj.data = mesh
        except Exception:
            remove_object(obj)
            created = bpy.data.objects.new(name, mesh)
            link_object(created, collection)
            return created
        if old is not None and old != mesh:
            retired.append(old)
        return obj

    def component(seq, index):
        try:
            number = float(seq[index])
        except (TypeError, ValueError, IndexError):
            return 0.0
        if not math.isfinite(number):
            return 0.0
        return number

    def set_transform(obj, item):
        loc = item.get("location") or (0.0, 0.0, 0.0)
        rot = item.get("rotation") or (0.0, 0.0, 0.0)
        obj.location = (component(loc, 0), component(loc, 1), component(loc, 2))
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = (component(rot, 0), component(rot, 1), component(rot, 2))
        obj.scale = (1.0, 1.0, 1.0)

    def cutter_names():
        """Names of objects another object's Boolean modifier cuts with, and of
        cutters already used up. They shape a piece; they are not pieces."""
        found = set()
        for owner in bpy.data.objects:
            if as_bool(owner.get("proink_ignore", False), False):
                found.add(owner.name)
            try:
                modifiers = owner.modifiers
            except Exception:
                continue
            for modifier in modifiers:
                if modifier.type != "BOOLEAN":
                    continue
                target = getattr(modifier, "object", None)
                if target is not None:
                    found.add(target.name)
                group = getattr(modifier, "collection", None)
                if group is not None:
                    for member in group.all_objects:
                        found.add(member.name)
        return found

    def bake_modifiers(obj):
        """The studio's mesh already has every cut, so the object's own modifiers
        are dropped. Their Boolean cutters are hidden and marked used, never deleted."""
        try:
            modifiers = list(obj.modifiers)
        except Exception:
            return
        for modifier in modifiers:
            if modifier.type == "BOOLEAN":
                cutters = []
                if getattr(modifier, "object", None) is not None:
                    cutters.append(modifier.object)
                if getattr(modifier, "collection", None) is not None:
                    cutters.extend(modifier.collection.all_objects)
                for cutter in cutters:
                    try:
                        cutter["proink_ignore"] = True
                        cutter.hide_render = True
                        apply_hide_set(cutter, True)
                        _pending_hide.append((cutter, True))
                    except Exception:
                        pass
            try:
                obj.modifiers.remove(modifier)
            except Exception:
                pass

    def index_by_id():
        found = {}
        objects = list(bpy.data.objects)
        objects.sort(key=lambda obj: obj.name)
        for obj in objects:
            pid = prop_str(obj, "proink_id")
            if pid and pid not in found:
                found[pid] = obj
        return found

    def apply_units_once():
        # scale_length stays 1: one Blender unit is still one meter. MILLIMETERS
        # only changes how the UI labels those meters. Message coordinates are
        # already meters, so this must not become 0.001.
        global _units_set
        if _units_set:
            return
        unit = bpy.context.scene.unit_settings
        unit.system = "METRIC"
        unit.scale_length = 1.0
        unit.length_unit = "MILLIMETERS"
        _units_set = True

    def read_evaluated(obj, depsgraph):
        """Local evaluated positions, triangle indices, and the mesh signature.

        ``to_mesh`` vertices are in the object's local frame. Object scale is
        not baked into those coordinates.
        """
        ev = obj.evaluated_get(depsgraph)
        me = None
        try:
            me = ev.to_mesh()
            if me is None:
                return None
            me.calc_loop_triangles()
            coords = [v.co for v in me.vertices]
            positions = []
            for co in coords:
                positions.extend((r6(co[0]), r6(co[1]), r6(co[2])))
            indices = []
            for tri in me.loop_triangles:
                indices.extend((int(tri.vertices[0]), int(tri.vertices[1]), int(tri.vertices[2])))
            signature = mesh_signature(len(me.vertices), len(me.loop_triangles), coords)
            return positions, indices, signature
        finally:
            if me is not None:
                ev.to_mesh_clear()

    def sync_one(item, by_id, missing, stats, needs_sig, retired):
        if not isinstance(item, dict):
            return
        raw_id = item.get("id")
        if raw_id is None or str(raw_id) == "":
            return
        pid = str(raw_id)
        source = item.get("source")
        if source not in SOURCES:
            missing.append(pid)
            return
        name = str(item.get("name") or pid)
        tag = tag_string(item.get("tag", ""))
        hash_value = "" if item.get("hash") is None else str(item.get("hash"))
        hidden = as_bool(item.get("hidden", False), False)
        material_spec = item.get("material") if isinstance(item.get("material"), dict) else {}
        obj = by_id.get(pid)
        if obj is not None and prop_str(obj, "proink_hash") == hash_value:
            return

        if source == "blender":
            if obj is None:
                missing.append(pid)
                return
            obj.name = name
            obj["proink_tag"] = tag
            obj["proink_hash"] = hash_value
            assign_material(obj, ensure_material(material_spec))
            set_hidden(obj, hidden)
            stats["updated"] += 1
            return

        has_positions = "positions" in item and item.get("positions") is not None
        collection = ensure_collection(COLLECTION_BOOTH if source == "booth" else COLLECTION_STUDIO)
        if has_positions:
            indices = item["indices"] if ("indices" in item and item.get("indices") is not None) else None
            try:
                mesh = build_mesh(name, item.get("positions"), indices, wants_smooth(tag))
            except Exception:
                missing.append(pid)
                return
            if obj is None:
                obj = bpy.data.objects.new(name, mesh)
                link_object(obj, collection)
                stats["created"] += 1
            else:
                obj = swap_mesh(obj, mesh, collection, name, retired)
                stats["updated"] += 1
            if source == "studio":
                bake_modifiers(obj)
            by_id[pid] = obj
        else:
            if obj is None:
                missing.append(pid)
                return
            if not obj.users_collection:
                link_object(obj, collection)
            stats["updated"] += 1

        set_transform(obj, item)
        obj.name = name
        assign_material(obj, ensure_material(material_spec))
        set_hidden(obj, hidden)
        obj["proink_id"] = pid
        obj["proink_source"] = source
        obj["proink_hash"] = hash_value
        obj["proink_tag"] = tag
        needs_sig.append(obj)

    def cmd_sync(request):
        objects = request.get("objects")
        if not isinstance(objects, list):
            return {"ok": False, "error": "objects must be a list"}
        apply_units_once()
        _pending_hide.clear()
        by_id = index_by_id()
        missing = []
        stats = {"created": 0, "updated": 0, "removed": 0}
        needs_sig = []
        retired = []
        for item in objects:
            sync_one(item, by_id, missing, stats, needs_sig, retired)
        if as_bool(request.get("prune", False), False):
            incoming = set()
            for item in objects:
                if isinstance(item, dict) and item.get("id") not in (None, ""):
                    incoming.add(str(item["id"]))
            victims = []
            cutters = cutter_names()
            for obj in list(bpy.data.objects):
                pid = prop_str(obj, "proink_id")
                if pid and pid not in incoming and obj.name not in cutters:
                    victims.append(obj)
            victim_ids = {id(obj) for obj in victims}
            for obj in victims:
                remove_object(obj)
                stats["removed"] += 1
            needs_sig = [obj for obj in needs_sig if id(obj) not in victim_ids]
        try:
            bpy.context.view_layer.update()
        except Exception:
            pass
        purge_meshes(retired)
        flush_hide()
        if needs_sig:
            try:
                bpy.context.view_layer.update()
            except Exception:
                pass
            try:
                depsgraph = bpy.context.evaluated_depsgraph_get()
            except Exception:
                depsgraph = None
            for obj in needs_sig:
                signature = ""
                if depsgraph is not None:
                    try:
                        read = read_evaluated(obj, depsgraph)
                        if read is not None:
                            signature = read[2]
                    except Exception:
                        signature = ""
                try:
                    obj["proink_sig"] = signature
                except Exception:
                    pass
        reply = {
            "ok": True,
            "created": stats["created"],
            "updated": stats["updated"],
            "removed": stats["removed"],
            "missing": missing,
            "file": bpy.data.filepath or "",
        }
        return commit(reply, "ProInk sync", include_file=True)

    def assign_missing_ids(objects):
        groups = {}
        for obj in objects:
            pid = prop_str(obj, "proink_id")
            if not pid:
                continue
            groups.setdefault(pid, []).append(obj)
        taken = taken_ids()
        for pid, members in groups.items():
            members.sort(key=lambda obj: obj.name)
            for extra in members[1:]:
                source = prop_str(extra, "proink_source")
                if source not in SOURCES:
                    source = "booth" if in_booth(extra) else "blender"
                try:
                    extra["proink_id"] = make_id(extra.name, taken)
                    extra["proink_source"] = source
                except Exception:
                    pass
        for obj in objects:
            if prop_str(obj, "proink_id"):
                continue
            source = "booth" if in_booth(obj) else "blender"
            try:
                obj["proink_id"] = make_id(obj.name, taken)
                obj["proink_source"] = source
            except Exception:
                pass

    def vec3(value):
        return [r6(value[0]), r6(value[1]), r6(value[2])]

    def material_name(obj):
        try:
            slots = obj.material_slots
        except Exception:
            return ""
        if slots and slots[0].material:
            return slots[0].material.name
        return ""

    def object_hidden(obj):
        try:
            return bool(obj.hide_get())
        except Exception:
            return bool(obj.hide_viewport)

    def reported_source(obj):
        if in_booth(obj):
            return "booth"
        source = prop_str(obj, "proink_source")
        if source in SOURCES:
            return source
        return "blender"

    def cmd_scene(_request):
        scene = bpy.context.scene
        cutters = cutter_names()
        objects = [obj for obj in scene.objects if obj.type in GEOMETRY_TYPES and obj.name not in cutters]
        objects.sort(key=lambda obj: obj.name)
        assign_missing_ids(objects)
        try:
            bpy.context.view_layer.update()
        except Exception:
            pass
        depsgraph = bpy.context.evaluated_depsgraph_get()
        reported = []
        for obj in objects:
            source = reported_source(obj)
            positions = None
            indices = None
            reshaped = False
            # A failed mesh read must not drop the object. The next prune would
            # treat a missing report as "delete this piece".
            try:
                if source == "studio":
                    read = read_evaluated(obj, depsgraph)
                    if read is not None:
                        positions, indices, signature = read
                        reshaped = signature != prop_str(obj, "proink_sig")
                        if not reshaped:
                            positions = None
                            indices = None
                elif source == "blender":
                    read = read_evaluated(obj, depsgraph)
                    if read is not None:
                        positions, indices, _signature = read
            except Exception:
                positions = None
                indices = None
                reshaped = False
            try:
                location = vec3(obj.matrix_world.to_translation())
                rotation = vec3(obj.matrix_world.to_euler("XYZ"))
                scale = vec3(obj.matrix_world.to_scale())
            except Exception:
                location = [0.0, 0.0, 0.0]
                rotation = [0.0, 0.0, 0.0]
                scale = [1.0, 1.0, 1.0]
            entry = {
                "id": prop_str(obj, "proink_id"),
                "name": obj.name,
                "source": source,
                "tag": prop_str(obj, "proink_tag"),
                "hash": prop_str(obj, "proink_hash"),
                "reshaped": reshaped,
                "location": location,
                "rotation": rotation,
                "scale": scale,
                "hidden": object_hidden(obj),
                "materialName": material_name(obj),
            }
            if positions is not None:
                entry["positions"] = positions
                entry["indices"] = indices
            reported.append(entry)
        return {"ok": True, "file": bpy.data.filepath or "", "objects": reported}

    def ensure_object_mode():
        try:
            obj = bpy.context.object
            if obj is None:
                obj = bpy.context.view_layer.objects.active
            if obj is not None and getattr(obj, "mode", "OBJECT") != "OBJECT":
                with blender_context():
                    bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass

    def cmd_exec(request):
        code = request.get("code")
        if not isinstance(code, str):
            return {"ok": False, "output": "", "error": "code must be a string"}
        ensure_object_mode()
        namespace = {
            "bpy": bpy,
            "mathutils": mathutils,
            "Vector": Vector,
            "math": math,
            "proink": PROINK,
            "__name__": "proink_exec",
        }
        buffer = _limited_output()
        try:
            with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
                exec(code, namespace)
            reply = {"ok": True, "output": buffer.getvalue()}
        except (Exception, SystemExit):
            reply = {
                "ok": False,
                "output": buffer.getvalue(),
                "error": _tail(traceback.format_exc(), ERROR_LIMIT),
            }
        return commit(reply, "ProInk exec", include_file=False)

    def visible_objects(candidates):
        found = []
        for obj in candidates:
            try:
                shown = obj.visible_get()
            except Exception:
                shown = not obj.hide_viewport
            if shown:
                found.append(obj)
        return found

    def world_bounds(objects):
        try:
            bpy.context.view_layer.update()
        except Exception:
            pass
        depsgraph = bpy.context.evaluated_depsgraph_get()
        minx = miny = minz = math.inf
        maxx = maxy = maxz = -math.inf
        any_point = False
        for obj in objects:
            try:
                ev = obj.evaluated_get(depsgraph)
                matrix = ev.matrix_world
                corners = ev.bound_box
            except Exception:
                continue
            for corner in corners:
                world = matrix @ Vector(corner)
                any_point = True
                if world.x < minx:
                    minx = world.x
                if world.y < miny:
                    miny = world.y
                if world.z < minz:
                    minz = world.z
                if world.x > maxx:
                    maxx = world.x
                if world.y > maxy:
                    maxy = world.y
                if world.z > maxz:
                    maxz = world.z
        if not any_point:
            return None
        mins = Vector((minx, miny, minz))
        maxs = Vector((maxx, maxy, maxz))
        return mins, maxs

    def bounds_corners(mins, maxs):
        corners = []
        for x in (mins.x, maxs.x):
            for y in (mins.y, maxs.y):
                for z in (mins.z, maxs.z):
                    corners.append(Vector((x, y, z)))
        return corners

    def camera_quaternion(view, look_direction):
        # to_track_quat('-Z', 'Y') aims the camera along look_direction and
        # tries to keep local +Y toward world +Z. Looking straight down makes
        # that up-axis parallel to the view, so top is identity: local -Z is
        # world -Z and local +Y is world +Y.
        if view == "top":
            return Quaternion((1.0, 0.0, 0.0, 0.0))
        return Vector(look_direction).normalized().to_track_quat("-Z", "Y")

    def projected_extents(corners, quat, center):
        rot = quat.to_matrix()
        right = rot.col[0]
        up = rot.col[1]
        xs = [(point - center).dot(right) for point in corners]
        ys = [(point - center).dot(up) for point in corners]
        return max(xs) - min(xs), max(ys) - min(ys)

    def remember(owner, names):
        saved = {}
        for name in names:
            if hasattr(owner, name):
                try:
                    saved[name] = getattr(owner, name)
                except Exception:
                    pass
        return saved

    def restore_attrs(owner, saved):
        for name, value in saved.items():
            try:
                setattr(owner, name, value)
            except Exception:
                pass

    def written_png(folder, preferred):
        if os.path.isfile(preferred) and os.path.getsize(preferred) > 8:
            return preferred
        # Still renders often append a frame number, so front.png becomes front0001.png.
        stem = os.path.splitext(os.path.basename(preferred))[0]
        pngs = []
        try:
            names = os.listdir(folder)
        except OSError:
            names = []
        for name in names:
            path = os.path.join(folder, name)
            if not name.lower().endswith(".png") or not name.startswith(stem):
                continue
            if os.path.isfile(path) and os.path.getsize(path) > 8:
                pngs.append(path)
        if pngs:
            pngs.sort(key=lambda path: os.path.getmtime(path))
            return pngs[-1]
        image = bpy.data.images.get("Render Result")
        if image is not None:
            try:
                image.save_render(preferred)
            except Exception:
                return None
            if os.path.isfile(preferred) and os.path.getsize(preferred) > 8:
                return preferred
        return None

    def cmd_look(request):
        size = clamp_size(request.get("size", RENDER_MIN))
        views = request.get("views") or []
        if not isinstance(views, (list, tuple)):
            return {"ok": False, "error": "views must be a list"}
        scene = bpy.context.scene
        proink = [obj for obj in scene.objects if prop_str(obj, "proink_id")]
        chosen = visible_objects(proink)
        if not chosen:
            meshes = [obj for obj in scene.objects if obj.type == "MESH"]
            chosen = visible_objects(meshes)
        if not chosen:
            return {"ok": True, "images": []}
        for view in views:
            if view not in VIEW_OFFSETS and view != "iso":
                return {"ok": False, "error": f"Unknown view: {view}"}
        if len(views) == 0:
            return {"ok": True, "images": []}
        bounds = world_bounds(chosen)
        if bounds is None:
            return {"ok": True, "images": []}
        mins, maxs = bounds
        center = (mins + maxs) * 0.5
        diagonal = (maxs - mins).length
        if not math.isfinite(diagonal) or diagonal < 1e-8:
            diagonal = 1.0
        corners = bounds_corners(mins, maxs)
        res_x = size
        res_y = max(1, int(round(size * 0.75)))

        render = scene.render
        saved_render = remember(
            render,
            (
                "engine",
                "resolution_x",
                "resolution_y",
                "resolution_percentage",
                "filepath",
                "film_transparent",
                "use_file_extension",
                "use_sequencer",
                "use_compositing",
            ),
        )
        saved_format = render.image_settings.file_format
        saved_color_mode = render.image_settings.color_mode
        saved_camera = scene.camera
        shading = scene.display.shading
        saved_shading = remember(shading, ("light", "color_type", "show_cavity"))
        folder = tempfile.mkdtemp(prefix="proink_look_")
        cam = None
        cam_data = None
        images = []
        try:
            cam_data = bpy.data.cameras.new("_proink_look")
            cam_data.type = "ORTHO"
            cam_data.sensor_fit = "HORIZONTAL"
            cam_data.clip_start = 0.001
            cam = bpy.data.objects.new("_proink_look", cam_data)
            link_object(cam, scene.collection)
            scene.camera = cam
            render.engine = "BLENDER_WORKBENCH"
            render.resolution_x = res_x
            render.resolution_y = res_y
            if hasattr(render, "resolution_percentage"):
                render.resolution_percentage = 100
            render.film_transparent = False
            render.image_settings.file_format = "PNG"
            render.image_settings.color_mode = "RGB"
            render.use_file_extension = True
            # Sequencer strips and the compositor replace the 3D picture.
            if hasattr(render, "use_sequencer"):
                render.use_sequencer = False
            if hasattr(render, "use_compositing"):
                render.use_compositing = False
            try:
                shading.light = "STUDIO"
            except Exception:
                pass
            try:
                shading.color_type = "MATERIAL"
            except Exception:
                pass
            try:
                shading.show_cavity = True
            except Exception:
                pass
            for view in views:
                if view == "iso":
                    offset = Vector(iso_offset())
                else:
                    offset = Vector(VIEW_OFFSETS[view])
                offset.normalize()
                look = -offset
                quat = camera_quaternion(view, look)
                distance = diagonal * 2.0 + 1.0
                cam.location = center + offset * distance
                cam.rotation_mode = "QUATERNION"
                cam.rotation_quaternion = quat
                if view == "iso":
                    proj_w = diagonal
                    proj_h = diagonal
                else:
                    proj_w, proj_h = projected_extents(corners, quat, center)
                cam_data.ortho_scale = fit_ortho_scale(proj_w, proj_h, res_x, res_y)
                cam_data.clip_end = distance + diagonal + 1000.0
                preferred = os.path.join(folder, f"{view}.png")
                render.filepath = preferred
                try:
                    bpy.context.view_layer.update()
                except Exception:
                    pass
                with blender_context():
                    result = bpy.ops.render.render(write_still=True)
                if operator_failed(result):
                    raise RuntimeError(f"Render did not finish for {view}")
                path = written_png(folder, preferred)
                if path is None:
                    raise RuntimeError(f"Render wrote no PNG for {view}")
                with open(path, "rb") as handle:
                    png = base64.b64encode(handle.read()).decode("ascii")
                images.append({"view": view, "png": png})
        finally:
            restore_attrs(render, saved_render)
            try:
                render.image_settings.file_format = saved_format
            except Exception:
                pass
            try:
                render.image_settings.color_mode = saved_color_mode
            except Exception:
                pass
            restore_attrs(shading, saved_shading)
            try:
                scene.camera = saved_camera
            except Exception:
                pass
            if cam is not None:
                data = cam.data
                try:
                    bpy.data.objects.remove(cam, do_unlink=True)
                except Exception:
                    data = cam_data
                if data is not None and getattr(data, "users", 1) == 0:
                    try:
                        bpy.data.cameras.remove(data)
                    except Exception:
                        pass
            elif cam_data is not None and getattr(cam_data, "users", 1) == 0:
                try:
                    bpy.data.cameras.remove(cam_data)
                except Exception:
                    pass
            shutil.rmtree(folder, ignore_errors=True)
        return {"ok": True, "images": images}

    def expand_save_path(path):
        text = os.path.expanduser(str(path))
        try:
            text = bpy.path.abspath(text)
        except Exception:
            pass
        if not os.path.isabs(text):
            text = os.path.abspath(text)
        return text

    def cmd_save(request):
        path = request.get("path")
        if path:
            filepath = expand_save_path(path)
            try:
                with blender_context():
                    result = bpy.ops.wm.save_as_mainfile(filepath=filepath)
                if operator_failed(result):
                    return {
                        "ok": False,
                        "file": bpy.data.filepath or "",
                        "error": "Save did not finish",
                    }
            except Exception as exc:
                return {"ok": False, "file": bpy.data.filepath or "", "error": str(exc)[:ERROR_LIMIT]}
            return {"ok": True, "file": bpy.data.filepath or ""}
        if not bpy.data.filepath:
            return {"ok": False, "file": "", "error": UNSAVED_ERROR}
        try:
            with blender_context():
                result = bpy.ops.wm.save_mainfile()
            if operator_failed(result):
                return {"ok": False, "file": bpy.data.filepath, "error": "Save did not finish"}
        except Exception as exc:
            return {"ok": False, "file": bpy.data.filepath, "error": str(exc)[:ERROR_LIMIT]}
        return {"ok": True, "file": bpy.data.filepath}

    def cmd_ping(_request):
        return {
            "ok": True,
            "blender": bpy.app.version_string,
            "file": bpy.data.filepath or "",
            "objects": count_proink_objects(),
        }

    COMMANDS = {
        "ping": cmd_ping,
        "sync": cmd_sync,
        "scene": cmd_scene,
        "exec": cmd_exec,
        "look": cmd_look,
        "save": cmd_save,
    }

    def dispatch(request):
        if not isinstance(request, dict):
            return {"ok": False, "error": "Expected a JSON object"}
        command = request.get("command")
        if not isinstance(command, str):
            return {"ok": False, "error": UNKNOWN_COMMAND}
        handler = COMMANDS.get(command)
        if handler is None:
            return {"ok": False, "error": UNKNOWN_COMMAND}
        return handler(request)

    def operator_failed(result):
        if isinstance(result, set):
            return "FINISHED" not in result
        return False

    @contextlib.contextmanager
    def blender_context():
        """Give operators a window, for timer calls that have no UI context of their own."""
        window = None
        try:
            window = bpy.context.window
        except Exception:
            window = None
        if window is None:
            try:
                windows = list(bpy.context.window_manager.windows)
            except Exception:
                windows = []
            window = windows[0] if windows else None
        if window is None or getattr(window, "screen", None) is None:
            yield
            return
        area = next((item for item in window.screen.areas if item.type == "VIEW_3D"), None)
        if area is None and window.screen.areas:
            area = window.screen.areas[0]
        region = None
        if area is not None:
            region = next((item for item in area.regions if item.type == "WINDOW"), None)
        override = {"window": window, "screen": window.screen}
        if area is not None:
            override["area"] = area
        if region is not None:
            override["region"] = region
        # Entering the override can fail in a timer. A failure inside the
        # caller's block must still propagate, so it is not caught here.
        try:
            manager = bpy.context.temp_override(**override)
        except Exception:
            yield
            return
        with manager:
            yield

    def commit(reply, undo_message, include_file):
        try:
            with blender_context():
                bpy.ops.ed.undo_push(message=undo_message)
        except Exception:
            pass
        save_error = ""
        if bpy.data.filepath:
            try:
                with blender_context():
                    result = bpy.ops.wm.save_mainfile()
                if operator_failed(result):
                    save_error = "Save did not finish"
            except Exception as exc:
                save_error = str(exc)[:ERROR_LIMIT]
        if include_file:
            reply["file"] = bpy.data.filepath or ""
        if save_error:
            # The sync or exec itself succeeded. The studio still gets ok:true.
            reply["saveError"] = save_error
        return reply

    def process_queue():
        if not _alive:
            return None
        try:
            item = _queue.get_nowait()
        except queue.Empty:
            return TIMER_INTERVAL
        _request, event, holder = item
        if holder.get("expired") or not _alive:
            holder.setdefault("result", {"ok": False, "error": STOPPING_ERROR})
            event.set()
            return TIMER_INTERVAL
        try:
            holder["result"] = dispatch(_request)
        except Exception:
            text = traceback.format_exc()
            print(text)
            holder["result"] = {"ok": False, "error": _tail(text, ERROR_LIMIT)}
        finally:
            event.set()
        return TIMER_INTERVAL

    def ensure_queue_timer():
        if not bpy.app.timers.is_registered(process_queue):
            bpy.app.timers.register(process_queue, first_interval=TIMER_INTERVAL, persistent=True)

    def current_port():
        try:
            addon = bpy.context.preferences.addons.get(__name__)
            if addon is not None and addon.preferences is not None:
                return int(addon.preferences.port)
        except Exception:
            pass
        return DEFAULT_PORT

    def server_running():
        return _httpd is not None and _thread is not None and _thread.is_alive()

    def submit_request(request):
        if not _alive:
            return {"ok": False, "error": STOPPING_ERROR}
        event = threading.Event()
        holder = {}
        with _lock:
            _inflight.append((event, holder))
        _queue.put((request, event, holder))
        try:
            if not event.wait(QUEUE_WAIT):
                holder["expired"] = True
                return {"ok": False, "error": TIMEOUT_ERROR}
            return holder.get("result") or {"ok": False, "error": TIMEOUT_ERROR}
        finally:
            with _lock:
                _inflight[:] = [(pending, box) for pending, box in _inflight if pending is not event]

    class BridgeServer(ThreadingHTTPServer):
        allow_reuse_address = True
        daemon_threads = True

        def server_bind(self):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            super().server_bind()

    class BridgeHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, fmt, *args):
            return

        def handle_one_request(self):
            try:
                super().handle_one_request()
            except (BrokenPipeError, ConnectionError, ConnectionResetError, socket.timeout):
                pass

        def _local(self):
            host = self.client_address[0] if self.client_address else ""
            return host in ("127.0.0.1", "::1")

        def _send(self, payload, status=200):
            try:
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            except (TypeError, ValueError):
                body = b'{"ok":false,"error":"Could not encode the reply"}'
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionError, ConnectionResetError):
                pass

        def _reject_method(self):
            if not self._local():
                self._send({"ok": False, "error": "Rejected non-local client"})
                return
            self._send({"ok": False, "error": "Only POST is accepted"})

        def do_GET(self):
            self._reject_method()

        def do_PUT(self):
            self._reject_method()

        def do_DELETE(self):
            self._reject_method()

        def do_PATCH(self):
            self._reject_method()

        def do_HEAD(self):
            self._reject_method()

        def do_OPTIONS(self):
            self._reject_method()

        def do_POST(self):
            if not self._local():
                self._send({"ok": False, "error": "Rejected non-local client"})
                return
            raw_length = self.headers.get("Content-Length")
            if raw_length is None:
                self._send({"ok": False, "error": "Content-Length required"})
                return
            try:
                length = int(raw_length)
            except ValueError:
                self._send({"ok": False, "error": "Content-Length required"})
                return
            if length < 0 or length > MAX_BODY:
                self._send({"ok": False, "error": "Body too large"})
                return
            try:
                raw = self.rfile.read(length)
            except (BrokenPipeError, ConnectionError, ConnectionResetError, socket.timeout):
                return
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                self._send({"ok": False, "error": "Body is not UTF-8"})
                return
            try:
                payload = json.loads(text) if text else None
            except json.JSONDecodeError:
                self._send({"ok": False, "error": "Invalid JSON"})
                return
            if not isinstance(payload, dict):
                self._send({"ok": False, "error": "Expected a JSON object"})
                return
            self._send(submit_request(payload))

    def start_server():
        global _httpd, _thread
        if server_running():
            return True, ""
        if _httpd is not None:
            stop_server()
        port = current_port()
        try:
            httpd = BridgeServer((HOST, port), BridgeHandler)
        except OSError as exc:
            _state["error"] = str(exc)
            return False, str(exc)
        thread = threading.Thread(
            target=httpd.serve_forever,
            kwargs={"poll_interval": 0.2},
            name="ProInkBridge",
            daemon=True,
        )
        thread.start()
        _httpd = httpd
        _thread = thread
        _state["port"] = port
        _state["error"] = ""
        print(f"ProInk Bridge listening on http://{HOST}:{port}")
        return True, ""

    def stop_server():
        global _httpd, _thread
        with _lock:
            pending = list(_inflight)
        drained = []
        while True:
            try:
                drained.append(_queue.get_nowait())
            except queue.Empty:
                break
        for _request, event, holder in drained:
            holder["expired"] = True
            holder["result"] = {"ok": False, "error": STOPPING_ERROR}
            event.set()
        for event, holder in pending:
            if not event.is_set():
                holder["expired"] = True
                holder["result"] = {"ok": False, "error": STOPPING_ERROR}
                event.set()
        httpd = _httpd
        thread = _thread
        _httpd = None
        _thread = None
        if httpd is not None:
            if thread is not None and thread.is_alive():
                httpd.shutdown()
            httpd.server_close()
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=2.0)
        _state["error"] = ""

    def deferred_start():
        if not _alive:
            return None
        ensure_queue_timer()
        ok, err = start_server()
        if not ok:
            print(f"ProInk Bridge did not start: {err}")
        return None

    class ProInkBridgePreferences(bpy.types.AddonPreferences):
        bl_idname = __name__

        port: bpy.props.IntProperty(
            name="Port",
            description="Localhost port. Stop the bridge and start it again after changing this",
            default=DEFAULT_PORT,
            min=1,
            max=65535,
        )

        def draw(self, _context):
            layout = self.layout
            layout.prop(self, "port")
            layout.label(text="Listens on 127.0.0.1 only. Restart the bridge after changing the port.")

    class PROINK_OT_server_start(bpy.types.Operator):
        bl_idname = "proink.server_start"
        bl_label = "Start"
        bl_description = "Listen for the ProInk studio on localhost"

        @classmethod
        def poll(cls, _context):
            return not server_running()

        def execute(self, context):
            ensure_queue_timer()
            ok, err = start_server()
            redraw_view3d(context)
            if not ok:
                self.report({"ERROR"}, err or "Could not start ProInk Bridge")
                return {"CANCELLED"}
            return {"FINISHED"}

    class PROINK_OT_server_stop(bpy.types.Operator):
        bl_idname = "proink.server_stop"
        bl_label = "Stop"
        bl_description = "Stop listening for the ProInk studio"

        @classmethod
        def poll(cls, _context):
            return server_running()

        def execute(self, context):
            stop_server()
            redraw_view3d(context)
            return {"FINISHED"}

    class PROINK_PT_bridge(bpy.types.Panel):
        bl_label = "ProInk Bridge"
        bl_idname = "PROINK_PT_bridge"
        bl_space_type = "VIEW_3D"
        bl_region_type = "UI"
        bl_category = "ProInk"

        def draw(self, _context):
            layout = self.layout
            if server_running():
                layout.label(text=f"Running on port {_state.get('port', DEFAULT_PORT)}")
            else:
                layout.label(text="Stopped")
            error = _state.get("error") or ""
            if error and not server_running():
                layout.label(text=error, icon="ERROR")
            try:
                path = bpy.data.filepath
            except Exception:
                path = ""
            layout.label(text=path or "(unsaved)")
            layout.label(text=f"ProInk objects: {count_proink_objects()}")
            row = layout.row(align=True)
            row.operator("proink.server_start", text="Start")
            row.operator("proink.server_stop", text="Stop")

    CLASSES = (
        ProInkBridgePreferences,
        PROINK_OT_server_start,
        PROINK_OT_server_stop,
        PROINK_PT_bridge,
    )

    def redraw_view3d(context):
        try:
            windows = context.window_manager.windows
        except Exception:
            return
        for window in windows:
            screen = window.screen
            if screen is None:
                continue
            for area in screen.areas:
                if area.type == "VIEW_3D":
                    area.tag_redraw()

    def register():
        global _alive, _units_set
        _alive = True
        _units_set = False
        for cls in CLASSES:
            bpy.utils.register_class(cls)
        ensure_queue_timer()
        if not bpy.app.timers.is_registered(deferred_start):
            bpy.app.timers.register(deferred_start, first_interval=0.2)

    def unregister():
        global _alive
        _alive = False
        stop_server()
        if bpy.app.timers.is_registered(process_queue):
            bpy.app.timers.unregister(process_queue)
        if bpy.app.timers.is_registered(deferred_start):
            bpy.app.timers.unregister(deferred_start)
        for cls in reversed(CLASSES):
            try:
                bpy.utils.unregister_class(cls)
            except Exception:
                pass

else:

    def register():
        raise RuntimeError("ProInk Bridge must be installed inside Blender 4.2 or newer")

    def unregister():
        return None


def _self_test():
    assert srgb_to_linear(0) == 0
    assert abs(srgb_to_linear(1) - 1) < 1e-12
    assert abs(srgb_to_linear(0.04045) - (0.04045 / 12.92)) < 1e-12
    assert abs(srgb_to_linear(0.5) - (((0.5 + 0.055) / 1.055) ** 2.4)) < 1e-12
    assert parse_hex("#ff8000") == (1.0, 128 / 255.0, 0.0)
    assert parse_hex("fff") == (1.0, 1.0, 1.0)
    assert parse_hex("nope") is None
    assert slug_name("Hello World!") == "hello-world"
    assert slug_name("Panel_01") == "panel-01"
    assert slug_name("---") == "piece"
    assert len(slug_name("a" * 100)) <= 40
    assert studio_mm(1000, 2000, 3000) == (1.0, -3.0, 2.0)
    assert studio_size(1000, 2000, 3000) == (1.0, 3.0, 2.0)
    assert wants_smooth('{"shape":"cylinder"}')
    assert wants_smooth('{"shape":"Tube"}')
    assert not wants_smooth('{"shape":"panel"}')
    assert not wants_smooth("not json")
    assert tag_payload("A", None, "built", None, "m", None) == {
        "name": "A",
        "kind": "built",
        "materialId": "m",
    }
    assert clamp_size(10) == 256
    assert clamp_size(5000) == 1600
    assert clamp_size(800) == 800
    assert as_bool("false") is False
    assert as_bool("true") is True
    assert grouped_vectors([1, 2, 3, 4]) == [(1.0, 2.0, 3.0)]
    assert grouped_vectors([1, float("nan"), 3]) is None
    assert triangle_faces(6, None) == [(0, 1, 2), (3, 4, 5)]
    assert triangle_faces(3, [0, 1, 9]) == []
    assert triangle_faces(3, [0, 1, 2, 2, 1, 0]) == [(0, 1, 2), (2, 1, 0)]
    signature = mesh_signature(8, 12, [(0, 0, 0), (1, 1, 1)])
    assert signature == "8:12:0,0,0,10000,10000,10000"
    assert mesh_signature(0, 0, []) == "0:0:0,0,0,0,0,0"
    scale = fit_ortho_scale(2, 4, 800, 600)
    assert abs(scale - (1.15 * 4 * (800 / 600))) < 1e-9
    length = math.sqrt(1 + 1.44 + 0.81)
    offset = iso_offset()
    assert abs(offset[0] - 1 / length) < 1e-12
    assert abs(offset[1] - (-1.2 / length)) < 1e-12
    assert abs(offset[2] - (0.9 / length)) < 1e-12
    assert r6(1.23456789) == 1.234568
    assert r6(float("nan")) == 0.0
    taken = set()
    made = make_id("Hello!", taken)
    assert made.startswith("hello-")
    assert made in taken
    assert len(made.rsplit("-", 1)[1]) == 4
    assert TIMEOUT_ERROR == "Blender did not answer in time"
    assert UNKNOWN_COMMAND == "Unknown command"
    assert "File > Save As" in UNSAVED_ERROR
    print("proink_bridge self-test ok")


if __name__ == "__main__":
    _self_test()
