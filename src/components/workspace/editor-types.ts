export type GizmoMode = "move" | "rotate" | "scale";

export type SnapSetting = {
  /** Grid size in mm. 0 is off. */
  grid: number;
  /** Stick to the faces of other pieces and to the floor-plan edges. */
  magnet: boolean;
};

export const GRID_STEPS = [0, 10, 50, 100] as const;

export const MAGNET_DISTANCE_MM = 25;

export const DEFAULT_SNAP: SnapSetting = { grid: 10, magnet: true };

export type PickModifiers = { shift: boolean; alt: boolean };
