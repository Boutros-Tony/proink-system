"use client";

import { ContactShadows, Edges, Environment, OrbitControls, OrthographicCamera, PerspectiveCamera, TransformControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentRef, type ReactNode, type RefObject } from "react";
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  NoToneMapping,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Euler,
  Vector3,
  type Camera,
  type Group,
  type LineSegments,
  type Object3D,
  type OrthographicCamera as ThreeOrthographicCamera,
  type PerspectiveCamera as ThreePerspectiveCamera,
  type Texture,
} from "three";
import { getAsset, subscribeAssets, type StudioAsset } from "@/lib/studio/assets";
import { boxGeometry } from "@/lib/systems/modular/front-face";
import { roundGeometry, tubeGeometry } from "@/lib/systems/modular/round-geometry";
import { buildLetterGeometry, getLetterFont, subscribeLetterFont } from "@/lib/files/letter-geometry";
import { getMesh, subscribeMeshes } from "@/lib/studio/meshes";
import { imageLayout } from "@/lib/systems/modular/images";
import {
  MAGNET_DISTANCE_MM,
  type GizmoMode,
  type PickModifiers,
  type SnapSetting,
} from "@/components/workspace/editor-types";
import type { CompiledBeam, CompiledModel, CompiledPanel, CompiledPart } from "@/lib/systems/modular/compile";
import { normalizeDegrees, partBounds, partCenter, partFootprint, snapMove, unionBounds } from "@/lib/systems/modular/geometry";
import { transformParts, type Transform } from "@/lib/systems/modular/ops";
import type { DesignDocument, PartImage, PartMaterial } from "@/lib/systems/modular/schema";

type ViewMode = "perspective" | "plan" | "front" | "render";

const PANEL_COLOR = {
  graphic: "#8f93f5",
  solid: "#eef0f7",
  lightbox: "#fff6dc",
};

const FINISH: Record<PartMaterial, { roughness: number; metalness: number; clearcoat: number }> = {
  paint: { roughness: 0.52, metalness: 0, clearcoat: 0.18 },
  mdf: { roughness: 0.94, metalness: 0, clearcoat: 0 },
  wood: { roughness: 0.58, metalness: 0, clearcoat: 0.04 },
  laminate: { roughness: 0.24, metalness: 0.02, clearcoat: 0.62 },
  metal: { roughness: 0.28, metalness: 0.88, clearcoat: 0.2 },
  glass: { roughness: 0.06, metalness: 0, clearcoat: 0 },
};

export default function Viewport({
  document,
  model,
  view,
  selection,
  mode,
  snap,
  explode,
  onPick,
  onTransform,
}: {
  document: DesignDocument;
  model: CompiledModel;
  view: ViewMode;
  /** 0 is assembled. 1 pulls every element fully apart so the joints and the construction show. */
  explode: number;
  selection: string[];
  mode: GizmoMode;
  snap: SnapSetting;
  onPick: (id: string | null, modifiers: PickModifiers) => void;
  onTransform: (ids: string[], transform: Transform) => void;
}) {
  const origin: [number, number, number] = [-document.envelope.width / 2000, 0, -document.envelope.depth / 2000];
  const span = Math.max(document.envelope.width, document.envelope.depth, document.envelope.height) / 1000;
  const rendered = view === "render";
  const [drag, setDrag] = useState<Transform | null>(null);
  // A handle drag ends with a click event. Ignore it so it does not clear the selection.
  const gizmoBusyUntil = useRef(0);

  const chosen = useMemo(() => new Set(selection), [selection]);
  const movable = useMemo(
    () => model.parts.filter((part) => chosen.has(part.id) && !part.locked && !part.hidden),
    [model.parts, chosen],
  );
  const movableIds = useMemo(() => movable.map((part) => part.id), [movable]);
  const shown = useMemo(
    () => (drag ? transformParts(model.parts, movableIds, drag) : model.parts),
    [model.parts, movableIds, drag],
  );
  const others = useMemo(
    () => model.parts.filter((part) => !chosen.has(part.id) && !part.hidden).map(partBounds),
    [model.parts, chosen],
  );
  // The pieces fly apart from the middle of the stand. A view of the construction, not an editing state.
  const exploding = explode > 0;
  const amountRef = useRef(0);
  const pivot = useMemo<Triple>(() => {
    const built = model.posts.length + model.panels.length + model.beams.length > 0;
    if (built) return [document.envelope.width / 2, document.envelope.height / 2, document.envelope.depth / 2];
    const bounds = unionBounds(model.parts.filter((part) => !part.hidden));
    if (!bounds) return [0, 0, 0];
    return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2];
  }, [model, document.envelope]);
  const gizmoMode: GizmoMode = mode === "scale" && movable.length !== 1 ? "move" : mode;
  // The pieces as they are drawn right now, including a drag in progress. The tag and the box follow these.
  const selectedNow = useMemo(() => shown.filter((part) => chosen.has(part.id) && !part.hidden), [shown, chosen]);
  const tagRef = useRef<HTMLDivElement>(null);
  function moveTag(transform: string, visible: boolean) {
    const element = tagRef.current;
    if (!element) return;
    element.style.transform = transform;
    element.style.visibility = visible ? "visible" : "hidden";
  }
  const showTag = selectedNow.length > 0 && view !== "render" && !exploding;

  /** Double-click: select just this piece, even if it belongs to a group. */
  function isolate(id: string) {
    if (performance.now() < gizmoBusyUntil.current) return;
    onPick(id, { shift: false, alt: true });
  }

  function pick(id: string | null, event: { nativeEvent: MouseEvent }) {
    if (performance.now() < gizmoBusyUntil.current) return;
    const native = event.nativeEvent;
    onPick(id, { shift: native.shiftKey || native.metaKey || native.ctrlKey, alt: native.altKey });
  }

  return (
    <div
      className={`relative h-full min-h-0 ${rendered ? "bg-[#e4e1db]" : "bg-[radial-gradient(ellipse_at_50%_35%,var(--panel)_0%,var(--raised)_80%,var(--line)_100%)]"}`}
    >
      <Canvas
        dpr={[1, 1.5]}
        shadows={rendered}
        gl={{ antialias: true, logarithmicDepthBuffer: true }}
        onPointerMissed={(event) => {
          if (performance.now() < gizmoBusyUntil.current) return;
          if (event.shiftKey || event.metaKey || event.ctrlKey) return;
          onPick(null, { shift: false, alt: false });
        }}
      >
        <Tone view={view} />
        <ExplodeDriver target={explode} amountRef={amountRef} />
        {view === "plan" ? (
          <OrthographicCamera makeDefault position={[0, 12, 0.01]} zoom={110} near={0.1} far={100} />
        ) : (
          <PerspectiveCamera makeDefault fov={rendered ? 32 : 40} position={[span, span * 0.7, span]} near={0.05} far={80} />
        )}
        <CameraRig view={view} span={span} />
        {rendered ? <Environment preset="studio" environmentIntensity={0.55} /> : null}
        <ambientLight intensity={rendered ? 0.28 : 1.25} />
        <hemisphereLight args={["#ffffff", rendered ? "#c8c2b8" : "#c9cee0", rendered ? 0.35 : 0.45]} />
        <directionalLight
          position={[4, 8, 5]}
          intensity={rendered ? 2.4 : 1.1}
          castShadow={rendered}
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.04}
        />
        {rendered ? <directionalLight position={[-4, 3, -2]} intensity={0.35} /> : null}
        {rendered ? null : <gridHelper args={[20, 20, "#a9afc6", "#d3d7e6"]} />}
        <group position={[-document.envelope.width / 2000, 0, -document.envelope.depth / 2000]}>
          {model.floor ? (
            <mesh position={[document.envelope.width / 2000, 0.01, document.envelope.depth / 2000]} receiveShadow={rendered}>
              <boxGeometry args={[document.envelope.width / 1000, 0.02, document.envelope.depth / 1000]} />
              <meshStandardMaterial color="#c3c8da" polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
            </mesh>
          ) : null}
          {model.posts.map((post, index) => (
            <Exploded key={post.id} center={[post.x, post.height / 2, post.z]} pivot={pivot} amountRef={amountRef}>
              <mesh position={[post.x / 1000, post.height / 2000, post.z / 1000]} castShadow={rendered} receiveShadow={rendered}>
                <boxGeometry args={[post.size / 1000, post.height / 1000, post.size / 1000]} />
                <meshStandardMaterial color="#aab2c4" metalness={0.45} roughness={0.35} {...faceOffset(index)} />
              </mesh>
            </Exploded>
          ))}
          {model.beams.map((beam) => (
            <Exploded key={beam.id} center={[(beam.x1 + beam.x2) / 2, beam.y, (beam.z1 + beam.z2) / 2]} pivot={pivot} amountRef={amountRef}>
              <BeamMesh beam={beam} rendered={rendered} />
            </Exploded>
          ))}
          {model.panels.map((panel, index) => (
            <Exploded key={panel.id} center={[panel.x, panel.y, panel.z]} pivot={pivot} amountRef={amountRef}>
              <PanelMesh panel={panel} selected={chosen.has(panel.id)} onPick={pick} offset={index} rendered={rendered} />
            </Exploded>
          ))}
          {model.fascias.map((fascia, index) => (
            <Exploded key={fascia.id} center={[fascia.x, fascia.y, fascia.z]} pivot={pivot} amountRef={amountRef}>
              <mesh position={[fascia.x / 1000, fascia.y / 1000, fascia.z / 1000]} castShadow={rendered}>
                <boxGeometry
                  args={
                    fascia.edge === "left" || fascia.edge === "right"
                      ? [fascia.thickness / 1000, fascia.height / 1000, fascia.length / 1000]
                      : [fascia.length / 1000, fascia.height / 1000, fascia.thickness / 1000]
                  }
                />
                <meshStandardMaterial color="#1a1d33" {...faceOffset(index + 4)} />
              </mesh>
            </Exploded>
          ))}
          {model.counters.map((counter) => (
            <Exploded key={counter.id} center={[counter.x, counter.y, counter.z]} pivot={pivot} amountRef={amountRef}>
              <mesh position={[counter.x / 1000, counter.y / 1000, counter.z / 1000]} castShadow={rendered} receiveShadow={rendered}>
                <boxGeometry args={[counter.width / 1000, counter.height / 1000, counter.depth / 1000]} />
                <meshStandardMaterial color="#3d3f6e" {...faceOffset(8)} />
              </mesh>
            </Exploded>
          ))}
          {model.spots.map((spot) => (
            <Exploded key={spot.id} center={[spot.x, spot.y, spot.z]} pivot={pivot} amountRef={amountRef}>
              <mesh position={[spot.x / 1000, spot.y / 1000, spot.z / 1000]}>
                <sphereGeometry args={[0.045, 16, 16]} />
                <meshStandardMaterial color="#f0c14a" emissive="#f0c14a" emissiveIntensity={0.4} />
              </mesh>
            </Exploded>
          ))}
          {shown.map((part, index) => {
            if (part.hidden) return null;
            const center = partCenter(part);
            return (
              <Exploded key={part.id} center={[center.x, center.y, center.z]} pivot={pivot} amountRef={amountRef}>
                <PartMesh part={part} selected={chosen.has(part.id)} onPick={pick} onIsolate={isolate} offset={index + 2} rendered={rendered} />
              </Exploded>
            );
          })}
        </group>
        {/* Outside the offset group: these position themselves in world space. */}
        {selectedNow.length > 0 && view !== "render" && !exploding ? (
          <>
            {selectedNow.length > 1 ? <SelectionBox parts={selectedNow} origin={origin} /> : null}
            <SelectionTagTracker parts={selectedNow} origin={origin} onMove={moveTag} />
          </>
        ) : null}
        {movable.length > 0 && view !== "render" && !exploding ? (
          <SelectionGizmo
            selected={movable}
            others={others}
            envelope={document.envelope}
            origin={origin}
            mode={gizmoMode}
            snap={snap}
            onStart={() => {
              gizmoBusyUntil.current = Number.POSITIVE_INFINITY;
            }}
            onEnd={() => {
              gizmoBusyUntil.current = performance.now() + 250;
            }}
            onDrag={setDrag}
            onCommit={onTransform}
          />
        ) : null}
        {rendered ? (
          <ContactShadows position={[0, 0, 0]} opacity={0.38} scale={Math.max(span * 4, 8)} blur={2.2} far={span * 2} frames={1} />
        ) : null}
        <OrbitControls
          key={view}
          makeDefault
          enableDamping
          target={[0, view === "render" ? span * 0.42 : view === "plan" ? 0 : span * 0.28, 0]}
        />
      </Canvas>
      {showTag ? <SelectionTag parts={selectedNow} dragging={drag !== null} tag={tagRef} /> : null}
      <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-line bg-panel/85 px-3 py-1.5 font-mono text-[11px] tracking-wide text-muted shadow-soft backdrop-blur-md">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
        {model.posts.length + model.panels.length + model.parts.length > 0
          ? `${Math.round(document.envelope.width)} × ${Math.round(document.envelope.depth)} × ${Math.round(document.envelope.height)} mm`
          : "Empty"}
      </div>
    </div>
  );
}

const noPick = () => null;

/** How far an element travels when fully exploded, as a multiple of its distance from the middle of the stand. */
const SPREAD = 1.4;

/** Eases the shared explode amount toward the slider, so the stand opens and closes smoothly. */
function ExplodeDriver({ target, amountRef }: { target: number; amountRef: RefObject<number> }) {
  useFrame((_, delta) => {
    const gap = target - amountRef.current;
    if (Math.abs(gap) < 0.0005) {
      amountRef.current = target;
      return;
    }
    amountRef.current += gap * Math.min(1, delta * 9);
  });
  return null;
}

/**
 * Moves one element away from the middle of the stand by the shared explode amount, and draws a thin guide
 * from where it sits assembled to where it is now. The guides show how every piece joins the others.
 * `center` and `pivot` are in mm.
 */
function Exploded({ center, pivot, amountRef, children }: { center: Triple; pivot: Triple; amountRef: RefObject<number>; children: ReactNode }) {
  const moving = useRef<Group>(null);
  const guide = useRef<LineSegments>(null);
  const [cx, cy, cz] = center;
  const [px, py, pz] = pivot;
  const delta = useMemo<Triple>(
    () => [((cx - px) / 1000) * SPREAD, ((cy - py) / 1000) * SPREAD, ((cz - pz) / 1000) * SPREAD],
    [cx, cy, cz, px, py, pz],
  );
  const geometry = useMemo(() => new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(delta[0], delta[1], delta[2])]), [delta]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(() => {
    const now = amountRef.current;
    moving.current?.position.set(delta[0] * now, delta[1] * now, delta[2] * now);
    if (guide.current) {
      guide.current.visible = now > 0.002;
      guide.current.scale.setScalar(now);
    }
  });
  return (
    <>
      <group ref={moving}>{children}</group>
      <lineSegments ref={guide} geometry={geometry} position={[center[0] / 1000, center[1] / 1000, center[2] / 1000]} visible={false} raycast={noPick}>
        <lineBasicMaterial color="#0c2785" transparent opacity={0.5} depthTest={false} />
      </lineSegments>
    </>
  );
}

function faceOffset(index: number) {
  return { polygonOffset: true as const, polygonOffsetFactor: 1, polygonOffsetUnits: index + 1 };
}

function Tone({ view }: { view: ViewMode }) {
  const get = useThree((state) => state.get);
  useLayoutEffect(() => {
    const { gl } = get();
    gl.toneMapping = view === "render" ? ACESFilmicToneMapping : NoToneMapping;
    gl.toneMappingExposure = view === "render" ? 1.05 : 1;
  }, [get, view]);
  return null;
}

function CameraRig({ view, span }: { view: ViewMode; span: number }) {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (view === "plan") {
        camera.up.set(0, 0, -1);
        camera.position.set(0, Math.max(span * 2.4, 10), 0.01);
      } else {
        camera.up.set(0, 1, 0);
        if (view === "front") camera.position.set(0, span * 0.55, span * 2.1);
        else if (view === "render") camera.position.set(span * 0.9, span * 0.46, span * 2.45);
        else camera.position.set(span * 1.45, span * 1.05, span * 1.85);
      }
      const lookY = view === "plan" ? 0 : view === "render" ? span * 0.42 : span * 0.28;
      camera.lookAt(0, lookY, 0);
      camera.updateProjectionMatrix();
    });
    return () => cancelAnimationFrame(frame);
  }, [camera, span, view]);
  return null;
}

function BeamMesh({ beam, rendered }: { beam: CompiledBeam; rendered: boolean }) {
  const dx = (beam.x2 - beam.x1) / 1000;
  const dz = (beam.z2 - beam.z1) / 1000;
  const length = Math.hypot(dx, dz);
  return (
    <mesh
      position={[(beam.x1 + beam.x2) / 2000, beam.y / 1000, (beam.z1 + beam.z2) / 2000]}
      rotation={[0, Math.atan2(dz, dx), 0]}
      castShadow={rendered}
    >
      <boxGeometry args={[length, beam.profile / 1000, beam.profile / 1000]} />
      <meshStandardMaterial color="#bcc3d2" metalness={0.4} roughness={0.4} {...faceOffset(3)} />
    </mesh>
  );
}

type PickHandler = (id: string | null, event: { nativeEvent: MouseEvent }) => void;

function PanelMesh({
  panel,
  selected,
  onPick,
  offset,
  rendered,
}: {
  panel: CompiledPanel;
  selected: boolean;
  onPick: PickHandler;
  offset: number;
  rendered: boolean;
}) {
  const horizontal = panel.edge === "back" || panel.edge === "front";
  return (
    <mesh
      position={[panel.x / 1000, panel.y / 1000, panel.z / 1000]}
      castShadow={rendered}
      receiveShadow={rendered}
      onClick={(event) => {
        event.stopPropagation();
        onPick(panel.id, event);
      }}
    >
      <boxGeometry
        args={
          horizontal
            ? [panel.width / 1000, panel.height / 1000, panel.thickness / 1000]
            : [panel.thickness / 1000, panel.height / 1000, panel.width / 1000]
        }
      />
      <meshStandardMaterial
        color={selected ? "#ffb454" : PANEL_COLOR[panel.kind]}
        emissive={selected ? "#7a4a10" : "#000000"}
        emissiveIntensity={selected ? 0.2 : 0}
        {...faceOffset(offset)}
      />
    </mesh>
  );
}

/** The real triangles from an imported file, scaled into the piece's current size. A box stands in until the file has loaded. */
function ImportedGeometry({ meshId, width, height, depth }: { meshId?: string; width: number; height: number; depth: number }) {
  const stored = useSyncExternalStore(subscribeMeshes, () => getMesh(meshId), () => undefined);
  const geometry = useMemo(() => {
    if (!stored) return null;
    const next = new BufferGeometry();
    next.setAttribute("position", new BufferAttribute(stored.positions.slice(), 3));
    if (stored.indices && stored.indices.length > 0) next.setIndex(new BufferAttribute(stored.indices.slice(), 1));
    next.computeVertexNormals();
    next.scale(
      (stored.width > 0 ? width / stored.width : 1) / 1000,
      (stored.height > 0 ? height / stored.height : 1) / 1000,
      (stored.depth > 0 ? depth / stored.depth : 1) / 1000,
    );
    return next;
  }, [stored, width, height, depth]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return <boxGeometry args={[width / 1000, height / 1000, depth / 1000]} />;
  return <primitive object={geometry} attach="geometry" />;
}

function PartMesh({
  part,
  selected,
  onPick,
  onIsolate,
  offset,
  rendered,
}: {
  part: CompiledPart;
  selected: boolean;
  onPick: PickHandler;
  onIsolate: (id: string) => void;
  offset: number;
  rendered: boolean;
}) {
  const finish = FINISH[part.material ?? "paint"];
  const glass = part.material === "glass";
  const plexi = part.shape === "letters" && glass;
  const map = useTiledMap(part.material === "wood" || part.material === "mdf" ? part.material : null, part.width, part.height);
  const center = partCenter(part);
  const [hovered, setHovered] = useState(false);
  // Never leave a pointer cursor behind if the piece disappears while hovered.
  useEffect(() => {
    if (!hovered) return;
    window.document.body.style.cursor = part.locked ? "not-allowed" : "pointer";
    return () => {
      window.document.body.style.cursor = "";
    };
  }, [hovered, part.locked]);
  const lit = hovered && !selected;
  // Tilt is the piece's own front-to-back roll, applied before the vertical turn. Cylinders stay upright.
  const orientation = useMemo(() => {
    const upright = part.shape === "cylinder";
    const yaw = (upright ? 0 : (part.rotation ?? 0)) * (Math.PI / 180);
    const roll = (upright ? 0 : (part.tilt ?? 0)) * (Math.PI / 180);
    return new Euler(0, yaw, roll, "YXZ");
  }, [part.shape, part.rotation, part.tilt]);
  return (
    <mesh
      position={[center.x / 1000, center.y / 1000, center.z / 1000]}
      rotation={orientation}
      castShadow={rendered && !glass}
      receiveShadow={rendered}
      onClick={(event) => {
        event.stopPropagation();
        onPick(part.id, event);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onIsolate(part.id);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {part.shape === "mesh" ? (
        <ImportedGeometry meshId={part.meshId} width={part.width} height={part.height} depth={part.depth} />
      ) : part.shape === "letters" ? (
        <LetterGeometry text={part.label?.trim() || part.name} width={part.width} height={part.height} depth={part.depth} />
      ) : part.shape === "cylinder" && part.round ? (
        <RoundPart part={part} />
      ) : part.shape === "cylinder" ? (
        <cylinderGeometry args={[part.width / 2000, part.width / 2000, part.height / 1000, 64]} />
      ) : part.shape === "tube" ? (
        <TubePart part={part} />
      ) : (
        <PartBox part={part} />
      )}
      <meshPhysicalMaterial
        color={part.color ?? "#f3efe6"}
        side={part.shape === "mesh" || part.shape === "letters" ? DoubleSide : undefined}
        map={map}
        roughness={finish.roughness}
        metalness={finish.metalness}
        clearcoat={finish.clearcoat}
        clearcoatRoughness={0.35}
        transmission={rendered && glass ? (plexi ? 0.55 : 0.92) : 0}
        thickness={plexi ? Math.max(0.004, part.depth / 1000) : glass ? 0.02 : 0}
        transparent={glass && !rendered}
        opacity={glass && !rendered ? (plexi ? 0.82 : 0.42) : 1}
        emissive={selected || lit ? "#0c2785" : "#000000"}
        emissiveIntensity={selected ? 0.16 : lit ? 0.08 : 0}
        {...faceOffset(offset)}
      />
      {selected ? <Edges color="#0c2785" threshold={20} /> : null}
      {lit ? <Edges color="#3a5dc9" threshold={20} /> : null}
      {part.images?.map((image) => (
        <ImageDecal key={image.face ?? "front"} part={part} image={image} />
      ))}
    </mesh>
  );
}

/** Cut letters from the font, filling the piece's height. A box stands in until the font has loaded. */
function LetterGeometry({ text, width, height, depth }: { text: string; width: number; height: number; depth: number }) {
  const font = useSyncExternalStore(subscribeLetterFont, getLetterFont, () => null);
  const geometry = useMemo(() => {
    const made = font ? buildLetterGeometry(font, text, width, height, depth) : null;
    return made ?? new BoxGeometry(width / 1000, height / 1000, depth / 1000);
  }, [font, text, width, height, depth]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

/** A cone, hollow, part-circle, or turned cylinder. */
function RoundPart({ part }: { part: CompiledPart }) {
  const { width, height, round } = part;
  const geometry = useMemo(() => roundGeometry({ width, height, round }) ?? new CylinderGeometry(width / 2000, width / 2000, height / 1000, 64), [width, height, round]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

/** A tube along its path: neon, a pipe, a rail, or a ring. */
function TubePart({ part }: { part: CompiledPart }) {
  const { width, height, depth, face, path, closed } = part;
  const geometry = useMemo(() => tubeGeometry({ width, height, depth, face, path, closed }) ?? new BoxGeometry(width / 1000, height / 1000, depth / 1000), [width, height, depth, face, path, closed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

/** A box. Square unless it is bent or a face has a rounded corner, a straight cut, or an opening. */
function PartBox({ part }: { part: CompiledPart }) {
  const { width, height, depth, corners, chamfers, holes, outline, face, curve } = part;
  const geometry = useMemo(() => {
    return boxGeometry({ width, height, depth, corners, chamfers, holes, outline, face, curve }) ?? new BoxGeometry(width / 1000, height / 1000, depth / 1000);
  }, [width, height, depth, corners, chamfers, holes, outline, face, curve]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

/* ---------------------------------------------------------------------------------------------
 * Pictures and logos printed on a face
 * ------------------------------------------------------------------------------------------- */

const textureCache = new Map<string, Texture>();

/** One GPU texture per picture, shared by every piece that uses it. */
function useAssetTexture(asset: StudioAsset | undefined) {
  return useMemo(() => {
    if (!asset) return null;
    const cached = textureCache.get(asset.id);
    if (cached) return cached;
    const texture = new TextureLoader().load(asset.dataUrl);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    textureCache.set(asset.id, texture);
    return texture;
  }, [asset]);
}

// The picture floats this far above the surface so it never fights with the piece for the same pixels.
const DECAL_LIFT = 0.0006;

/** Points of the face frame (meters): where the flat picture sits and which way it faces. */
type Triple = [number, number, number];

function faceFrame(part: CompiledPart, face: NonNullable<PartImage["face"]>): { position: Triple; rotation: Triple } {
  const width = part.width / 1000;
  const height = part.height / 1000;
  const depth = (part.shape === "cylinder" ? part.width : part.depth) / 1000;
  switch (face) {
    case "back":
      return { position: [0, 0, -depth / 2 - DECAL_LIFT], rotation: [0, Math.PI, 0] };
    case "right":
      return { position: [width / 2 + DECAL_LIFT, 0, 0], rotation: [0, Math.PI / 2, 0] };
    case "left":
      return { position: [-width / 2 - DECAL_LIFT, 0, 0], rotation: [0, -Math.PI / 2, 0] };
    case "top":
      return { position: [0, height / 2 + DECAL_LIFT, 0], rotation: [-Math.PI / 2, 0, 0] };
    default:
      return { position: [0, 0, depth / 2 + DECAL_LIFT], rotation: [0, 0, 0] };
  }
}

function ImageDecal({ part, image }: { part: CompiledPart; image: PartImage }) {
  const asset = useSyncExternalStore(
    subscribeAssets,
    () => getAsset(image.assetId),
    () => undefined,
  );
  const texture = useAssetTexture(asset);
  const aspect = asset ? asset.width / asset.height : 1;
  const cylinder = part.shape === "cylinder";
  const { shape, width: partWidth, height: partHeight, depth: partDepth } = part;
  const layout = useMemo(
    () => imageLayout({ shape, width: partWidth, height: partHeight, depth: partDepth }, image, aspect),
    [shape, partWidth, partHeight, partDepth, image, aspect],
  );

  const geometry = useMemo(() => {
    const { uv } = layout;
    const built = cylinder
      ? (() => {
          const diameter = partWidth / 1000;
          const arc = Math.min(Math.PI * 2, (layout.width / 1000 / (diameter / 2)) || 0.01);
          const centerAngle = layout.offsetX / 1000 / (diameter / 2);
          return new CylinderGeometry(
            diameter / 2 + DECAL_LIFT,
            diameter / 2 + DECAL_LIFT,
            layout.height / 1000,
            Math.max(8, Math.ceil((64 * arc) / (Math.PI * 2))),
            1,
            true,
            centerAngle - arc / 2,
            arc,
          );
        })()
      : new PlaneGeometry(layout.width / 1000, layout.height / 1000);
    const coordinates = built.getAttribute("uv");
    for (let index = 0; index < coordinates.count; index += 1) {
      coordinates.setXY(
        index,
        uv.u0 + coordinates.getX(index) * (uv.u1 - uv.u0),
        uv.v0 + coordinates.getY(index) * (uv.v1 - uv.v0),
      );
    }
    return built;
  }, [layout, cylinder, partWidth]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Nothing to draw until the picture has loaded, or if it was removed from the library.
  if (!asset || !texture) return null;

  const frame = faceFrame(part, image.face ?? "front");
  const material = (
    <meshStandardMaterial
      map={texture}
      transparent
      roughness={0.6}
      metalness={0}
      depthWrite={false}
      polygonOffset
      polygonOffsetFactor={-2}
      polygonOffsetUnits={-2}
    />
  );
  // Pictures never take clicks, so clicking one selects the piece underneath.
  const noRaycast = () => null;

  if (cylinder) {
    return (
      <mesh geometry={geometry} position={[0, layout.offsetY / 1000, 0]} raycast={noRaycast} renderOrder={2}>
        {material}
      </mesh>
    );
  }
  return (
    <group position={frame.position} rotation={frame.rotation}>
      <mesh geometry={geometry} position={[layout.offsetX / 1000, layout.offsetY / 1000, 0]} raycast={noRaycast} renderOrder={2}>
        {material}
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Selection feedback: a tag attached to the item, and a box around a multi-selection
 * ------------------------------------------------------------------------------------------- */

const ARM_AT_SIZE_ONE = 0.6;

type ViewCamera = Camera & Partial<ThreePerspectiveCamera> & Partial<ThreeOrthographicCamera>;

/**
 * The move handles are drawn at a fixed size on screen. Pick the size that reaches just past the
 * selected item, so the handles hug a small piece and still stay in reach on a big one.
 */
function gizmoSizing(camera: ViewCamera, center: Vector3, radius: number) {
  const zoom = camera.zoom ?? 1;
  let factor: number;
  let viewHeight: number;
  if (camera.isOrthographicCamera) {
    viewHeight = ((camera.top ?? 1) - (camera.bottom ?? -1)) / zoom;
    factor = viewHeight;
  } else {
    const distance = center.distanceTo(camera.position);
    const tangent = Math.tan(((camera.fov ?? 40) * Math.PI) / 360);
    factor = distance * Math.min((1.9 * tangent) / zoom, 7);
    viewHeight = (2 * distance * tangent) / zoom;
  }
  const arm = Math.min(viewHeight * 0.2, Math.max(viewHeight * 0.075, radius * 0.75));
  return { size: (arm * 7) / (ARM_AT_SIZE_ONE * factor), arm, viewHeight };
}

function boundsRadiusMeters(bounds: NonNullable<ReturnType<typeof unionBounds>>) {
  return Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2000;
}

function SelectionBox({ parts, origin }: { parts: CompiledPart[]; origin: [number, number, number] }) {
  const bounds = unionBounds(parts);
  const width = bounds ? (bounds.maxX - bounds.minX) / 1000 : 0;
  const height = bounds ? (bounds.maxY - bounds.minY) / 1000 : 0;
  const depth = bounds ? (bounds.maxZ - bounds.minZ) / 1000 : 0;
  const geometry = useMemo(() => {
    const box = new BoxGeometry(Math.max(width, 0.001), Math.max(height, 0.001), Math.max(depth, 0.001));
    const edges = new EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [width, height, depth]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (!bounds) return null;
  return (
    <lineSegments
      geometry={geometry}
      position={[
        origin[0] + (bounds.minX + bounds.maxX) / 2000,
        origin[1] + (bounds.minY + bounds.maxY) / 2000,
        origin[2] + (bounds.minZ + bounds.maxZ) / 2000,
      ]}
      raycast={() => null}
      renderOrder={5}
    >
      <lineBasicMaterial color="#0c2785" transparent opacity={0.55} depthTest={false} />
    </lineSegments>
  );
}

/**
 * Moves the selection tag over the selected item each frame. The tag itself is plain page content beside the
 * canvas: drei's Html mounts a second React root, and unmounting it mid-render crashes React 19.
 */
function SelectionTagTracker({
  parts,
  origin,
  onMove,
}: {
  parts: CompiledPart[];
  origin: [number, number, number];
  onMove: (transform: string, visible: boolean) => void;
}) {
  const bounds = unionBounds(parts);
  const anchor = useMemo(() => new Vector3(), []);
  const top = useMemo(() => new Vector3(), []);

  // Lift the tag just clear of the move handles, which grow and shrink with the zoom.
  useFrame(({ camera, size }) => {
    if (!bounds) return;
    anchor.set(
      origin[0] + (bounds.minX + bounds.maxX) / 2000,
      origin[1] + (bounds.minY + bounds.maxY) / 2000,
      origin[2] + (bounds.minZ + bounds.maxZ) / 2000,
    );
    const { arm, viewHeight } = gizmoSizing(camera as ViewCamera, anchor, boundsRadiusMeters(bounds));
    const lift = Math.round((arm / viewHeight) * size.height + 22);
    top.set(anchor.x, origin[1] + bounds.maxY / 1000, anchor.z).project(camera);
    const x = ((top.x + 1) / 2) * size.width;
    const y = ((1 - top.y) / 2) * size.height;
    onMove(`translate(${x}px, ${y}px) translate(-50%, calc(-50% - ${lift}px))`, top.z <= 1);
  });
  return null;
}

/** A small label pinned above the selected item: its name and size, plus its position while it moves. */
function SelectionTag({ parts, dragging, tag }: { parts: CompiledPart[]; dragging: boolean; tag: RefObject<HTMLDivElement | null> }) {
  const bounds = unionBounds(parts);
  if (!bounds) return null;
  const one = parts.length === 1 ? parts[0] : null;
  const dimensions = `${Math.round(bounds.maxX - bounds.minX)} × ${Math.round(bounds.maxZ - bounds.minZ)} × ${Math.round(bounds.maxY - bounds.minY)} mm`;
  const images = one?.images?.length ?? 0;
  return (
    <div className="pointer-events-none absolute top-0 left-0 z-20" style={{ visibility: "hidden" }} ref={tag}>
      <div className="flex max-w-[260px] flex-col items-center gap-0.5 rounded-lg border border-accent/30 bg-panel/95 px-2.5 py-1.5 text-center whitespace-nowrap shadow-float backdrop-blur-sm">
        <span className="max-w-full truncate text-xs font-semibold text-ink">{one ? one.name : `${parts.length} pieces`}</span>
        <span className="font-mono text-[10.5px] text-muted">
          {dragging
            ? `x ${Math.round(bounds.minX)}  y ${Math.round(bounds.minY)}  z ${Math.round(bounds.minZ)}`
            : `${dimensions}${images > 0 ? ` · ${images} image${images === 1 ? "" : "s"}` : ""}`}
        </span>
      </div>
    </div>
  );
}

function SelectionGizmo({
  selected,
  others,
  envelope,
  origin,
  mode,
  snap,
  onStart,
  onEnd,
  onDrag,
  onCommit,
}: {
  selected: CompiledPart[];
  others: ReturnType<typeof partBounds>[];
  envelope: DesignDocument["envelope"];
  /** World position, in meters, of the stand's back-left floor corner. */
  origin: [number, number, number];
  mode: GizmoMode;
  snap: SnapSetting;
  onStart: () => void;
  onEnd: () => void;
  onDrag: (transform: Transform | null) => void;
  onCommit: (ids: string[], transform: Transform) => void;
}) {
  const proxy = useRef<Object3D>(null);
  const controls = useRef<ComponentRef<typeof TransformControls>>(null);
  const latest = useRef<Transform | null>(null);
  const [generation, setGeneration] = useState(0);
  const bounds = unionBounds(selected);
  const sizingCenter = useMemo(() => new Vector3(), []);

  // Keep the handles hugging the item: small pieces get small handles, big ones get bigger handles.
  useFrame(({ camera }) => {
    // `size` is a public setting on the three.js control, but its type marks it private.
    const handle = controls.current as unknown as { size: number } | null;
    if (!handle || !bounds) return;
    sizingCenter.set(
      origin[0] + (bounds.minX + bounds.maxX) / 2000,
      origin[1] + (bounds.minY + bounds.maxY) / 2000,
      origin[2] + (bounds.minZ + bounds.maxZ) / 2000,
    );
    const { size } = gizmoSizing(camera as ViewCamera, sizingCenter, boundsRadiusMeters(bounds));
    if (Math.abs(handle.size - size) > 0.004) handle.size = size;
  });
  const ids = selected.map((part) => part.id);
  const single = selected.length === 1 ? selected[0] : null;
  const rotation = single && single.shape !== "cylinder" ? single.rotation ?? 0 : 0;
  // Remount the handle after every committed edit so it re-centers on the selection.
  const signature = `${mode}:${selected
    .map((part) => `${part.id}:${part.x},${part.y},${part.z},${part.width},${part.height},${part.depth},${part.rotation ?? 0},${part.tilt ?? 0}`)
    .join("|")}`;
  if (!bounds) return null;
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };

  function changed() {
    const object = proxy.current;
    if (!object || !bounds) return;
    let transform: Transform;
    if (mode === "move") {
      const raw = {
        x: (object.position.x - origin[0]) * 1000 - center.x,
        y: (object.position.y - origin[1]) * 1000 - center.y,
        z: (object.position.z - origin[2]) * 1000 - center.z,
      };
      const delta = snapMove(bounds, raw, others, {
        grid: snap.grid,
        magnet: snap.magnet ? MAGNET_DISTANCE_MM : 0,
        extra: { x: [0, envelope.width], y: [0, envelope.height], z: [0, envelope.depth] },
      });
      object.position.set(
        origin[0] + (center.x + delta.x) / 1000,
        origin[1] + (center.y + delta.y) / 1000,
        origin[2] + (center.z + delta.z) / 1000,
      );
      transform = { kind: "move", ...delta };
    } else if (mode === "rotate") {
      // Pieces only turn about the vertical axis, so read just the yaw of whatever the handle produced.
      const yaw = new Euler().setFromQuaternion(object.quaternion, "YXZ").y * (180 / Math.PI);
      transform = { kind: "rotate", degrees: normalizeDegrees(yaw) };
    } else {
      const part = single;
      const size = part ? { ...partFootprint(part), height: part.height } : null;
      const factor = (value: number, current: number | undefined) => {
        const next = Math.max(0.02, value);
        if (!current || snap.grid <= 0) return next;
        return Math.max(snap.grid, Math.round((current * next) / snap.grid) * snap.grid) / current;
      };
      transform = {
        kind: "scale",
        x: factor(object.scale.x, size?.width),
        y: factor(object.scale.y, size?.height),
        z: factor(object.scale.z, size?.depth),
      };
    }
    latest.current = transform;
    onDrag(transform);
  }

  function finish() {
    const transform = latest.current;
    latest.current = null;
    onDrag(null);
    onEnd();
    if (transform) onCommit(ids, transform);
    setGeneration((value) => value + 1);
  }

  return (
    <group key={`${signature}:${generation}`}>
      <object3D
        ref={proxy}
        position={[origin[0] + center.x / 1000, origin[1] + center.y / 1000, origin[2] + center.z / 1000]}
        rotation={[0, (mode === "scale" ? rotation : 0) * (Math.PI / 180), 0]}
      />
      <TransformControls
        ref={controls}
        object={proxy as RefObject<Object3D>}
        mode={mode === "move" ? "translate" : mode === "rotate" ? "rotate" : "scale"}
        space={mode === "scale" ? "local" : "world"}
        showX={mode !== "rotate"}
        showY
        showZ={mode !== "rotate" && !(mode === "scale" && single?.shape === "cylinder")}
        rotationSnap={snap.grid > 0 ? Math.PI / 12 : undefined}
        onMouseDown={onStart}
        onObjectChange={changed}
        onMouseUp={finish}
      />
    </group>
  );
}

const grainCache = new Map<string, Texture>();

function grainTexture(kind: "wood" | "mdf") {
  const cached = grainCache.get(kind);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, 0, 512, 512);
  if (kind === "wood") {
    for (let line = 0; line < 70; line += 1) {
      const x = (line / 70) * 512;
      ctx.strokeStyle = `rgba(70, 52, 32, ${0.05 + (line % 5) * 0.02})`;
      ctx.lineWidth = line % 4 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 10, 140, x - 12, 300, x + 6, 512);
      ctx.stroke();
    }
  } else {
    for (let speck = 0; speck < 900; speck += 1) {
      const shade = 168 + (speck % 40);
      ctx.fillStyle = `rgba(${shade}, ${shade - 6}, ${shade - 10}, 0.28)`;
      ctx.fillRect((speck * 47) % 512, (speck * 91) % 512, 2, 2);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  grainCache.set(kind, texture);
  return texture;
}

function useTiledMap(kind: "wood" | "mdf" | null, widthMm: number, heightMm: number) {
  return useMemo(() => {
    if (!kind) return null;
    const base = grainTexture(kind);
    if (!base) return null;
    const map = base.clone();
    map.wrapS = RepeatWrapping;
    map.wrapT = RepeatWrapping;
    map.repeat.set(Math.max(widthMm / 350, 0.5), Math.max(heightMm / 350, 0.5));
    map.needsUpdate = true;
    return map;
  }, [kind, widthMm, heightMm]);
}
