declare module "opentype.js" {
  export function parse(buffer: ArrayBuffer): {
    getPath(
      text: string,
      x: number,
      y: number,
      fontSize: number,
    ): {
      commands: Array<{
        type: string;
        x: number;
        y: number;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      }>;
    };
  };
}
