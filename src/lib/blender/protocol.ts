/**
 * What the studio and the ProInk add-on inside Blender send each other over http://127.0.0.1:9876.
 * Every request is a POST of one JSON object with a `command`. Every reply is JSON with `ok`, and `error` when it failed.
 *
 * Blender works in meters with Z up and the viewer looking toward +Y. The studio works in millimeters with Y up
 * and +Z toward the viewer. Everything in these messages is in Blender's own units and axes, so the add-on never converts.
 *
 * Three kinds of objects carry an `proink_source` property in Blender:
 * - `studio`: a piece the studio built from its own numbers (a panel, cylinder, tube, letters, or an imported mesh).
 *   Sync replaces its mesh and transform whenever its hash changes.
 * - `blender`: a free-form piece modeled in Blender. Sync only renames, retags, hides, or deletes it, never reshapes it.
 * - `booth`: the modular booth frame, drawn for reference and never read back.
 */

export const BLENDER_URL = process.env.BLENDER_URL ?? "http://127.0.0.1:9876";

export type BlenderSource = "studio" | "blender" | "booth";

export type BlenderMaterial = { name: string; color: string; metalness: number; roughness: number; alpha: number };

/** One object the studio wants in Blender. */
export type BlenderObjectIn = {
  /** The piece id, stored as `proink_id`. Unique among ProInk objects. */
  id: string;
  name: string;
  source: BlenderSource;
  /** Stored as `proink_hash`. An object whose hash is unchanged is left exactly as it is. */
  hash: string;
  /** The studio's piece as JSON, stored as `proink_tag`. Empty for booth objects. */
  tag: string;
  /** Flat [x, y, z, ...] in meters, in the object's own frame, centered on its origin. Missing keeps the current mesh. */
  positions?: number[];
  /** Triangles, three indices each. Missing means every three positions are a triangle. */
  indices?: number[];
  location: [number, number, number];
  /** Radians, Euler XYZ. */
  rotation: [number, number, number];
  hidden: boolean;
  material: BlenderMaterial;
};

/**
 * Make the ProInk objects match the list. Objects are found by `proink_id`, never by name.
 * `studio` and `booth` objects with a new hash get the new mesh (when sent), transform with scale 1, material, and name.
 * `blender` objects only take the new name, tag, material, and hidden flag.
 * With `prune`, ProInk objects whose id is not in the list are deleted. Objects without `proink_id` are never touched.
 * The file is saved afterwards when it already has a path.
 */
export type SyncRequest = { command: "sync"; objects: BlenderObjectIn[]; prune: boolean };
export type SyncReply = { ok: true; created: number; updated: number; removed: number; missing: string[]; file: string };

/** One mesh object as Blender has it now. */
export type BlenderObjectOut = {
  /** Every mesh, curve, and text object gets one: objects without one are given `<slug of name>-<4 random chars>` and source `blender`. A copy that shares an id with another object is given a new one. */
  id: string;
  name: string;
  source: BlenderSource;
  /** The stored `proink_tag`, or "" when the object has none. */
  tag: string;
  hash: string;
  /** True when the evaluated mesh (modifiers included) no longer matches the one sync built. Always false for `blender` objects. */
  reshaped: boolean;
  location: [number, number, number];
  /** Radians, Euler XYZ, whatever the object's rotation mode is. */
  rotation: [number, number, number];
  scale: [number, number, number];
  hidden: boolean;
  /** The first material slot's name, or "". */
  materialName: string;
  /** Sent for `blender` objects and reshaped `studio` objects: the evaluated mesh in the object's own frame, scale not applied, triangulated. */
  positions?: number[];
  indices?: number[];
};

export type SceneRequest = { command: "scene" };
export type SceneReply = { ok: true; file: string; objects: BlenderObjectOut[] };

/** Run Python inside Blender with `bpy`, `mathutils`, `Vector`, and the `proink` helpers in scope. Printed text comes back. */
export type ExecRequest = { command: "exec"; code: string };
export type ExecReply = { ok: boolean; output: string; error?: string };

export type LookView = "front" | "side" | "top" | "iso";
/** Workbench renders of the ProInk objects from fixed cameras, PNG as base64. */
export type LookRequest = { command: "look"; views: LookView[]; size: number };
export type LookReply = { ok: true; images: Array<{ view: LookView; png: string }> };

export type PingRequest = { command: "ping" };
export type PingReply = { ok: true; blender: string; file: string; objects: number };

export type SaveRequest = { command: "save"; path?: string };
export type SaveReply = { ok: boolean; file: string; error?: string };

/** A studio mesh as JSON between the browser and /api/blender: plain number arrays instead of typed arrays. */
export type MeshJson = { id: string; positions: number[]; indices: number[] | null; width: number; height: number; depth: number };

export type BlenderRequest = SyncRequest | SceneRequest | ExecRequest | LookRequest | PingRequest | SaveRequest;
