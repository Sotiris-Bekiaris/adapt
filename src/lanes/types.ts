export interface BaselineManifest {
  name: string;
  gitTag: string;
  commit: string;
  createdAt: string;
}

export interface LaneManifest {
  laneId: string;
  baseline: string;
  model: string | null;
  branch: string;
  composeProject: string;
  ports: { base: number; stride: number };
  consolePort: number;
  createdAt: string;
}
