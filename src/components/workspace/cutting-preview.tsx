"use client";

import { Download } from "lucide-react";
import { PreviewBar } from "@/components/workspace/preview";
import { formatCents } from "@/lib/format";
import { cuttingPlanSvg } from "@/lib/production/cutting-svg";
import { formatBoardSize, labelPoint, shapeOnBoard, tallyText, type CutBoard, type CuttingPlan, type PlacedPiece } from "@/lib/production/cutting";

/** The sheets to buy and how the workshop cuts them, opened over the model like the technical file. */
export function CuttingPreview({ plan, onClose }: { plan: CuttingPlan; onClose: () => void }) {
  const boards = plan.groups.reduce((sum, group) => sum + group.boards.length, 0);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PreviewBar title="Cutting plans" detail={plan.bladeSummary ?? (boards === 0 ? "Nothing to cut" : `${boards} ${boards === 1 ? "board" : "boards"}`)} onClose={onClose}>
        <button type="button" onClick={() => downloadPlan(plan)} disabled={plan.groups.length === 0} className="btn btn-primary px-3.5 py-2 text-xs">
          <Download size={14} strokeWidth={2.25} aria-hidden="true" />
          Download file
        </button>
      </PreviewBar>
      <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,#d5d9e8_1px,transparent_0)] bg-[length:20px_20px] bg-raised p-6">
        <div className="mx-auto max-w-5xl">
          <header className="mb-6 flex items-start justify-between gap-6">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Cutting plans</h2>
              <p className="mt-1 max-w-xl text-sm leading-5 text-muted">
                Each board as the workshop cuts it. The code is the part. Red dashed lines are the saw cuts, green is what is left over.
              </p>
            </div>
            {plan.bladeSummary ? <p className="shrink-0 text-sm text-muted">{plan.bladeSummary}</p> : null}
          </header>
          {plan.groups.length === 0 ? (
            <p className="rounded-2xl border border-line paper px-6 py-10 text-sm text-muted shadow-float">Nothing to cut yet. Add panels, shelves, or sheets and the boards they come out of will show up here.</p>
          ) : (
            <div className="space-y-8">
              {plan.groups.map((group) => (
                <section key={group.id}>
                  <h3 className="text-sm font-semibold">{group.title}</h3>
                  <p className="mt-1 text-sm text-ink">
                    {tallyText(group)} · {group.usedPercent}% used
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {group.blade.title}. {group.blade.detail}
                  </p>
                  {group.tally.some((line) => line.totalCents !== null) ? (
                    <p className="mt-1 font-mono text-xs text-muted">
                      {group.tally
                        .filter((line) => line.count > 0)
                        .map((line) => `${line.count} × ${line.name}${line.totalCents === null ? "" : ` · ${formatCents(line.totalCents)}`}`)
                        .join(" · ")}
                    </p>
                  ) : null}
                  {group.suggestionNote ? <p className="mt-2 max-w-2xl text-xs leading-5 text-warn">{group.suggestionNote}</p> : null}
                  {group.oversize.length > 0 ? (
                    <p className="mt-1 text-xs text-muted">{group.oversize.join(", ")} {group.oversize.length === 1 ? "is" : "are"} bigger than one sheet, so the plan joins pieces.</p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-6">
                    {group.boards.map((board) => (
                      <BoardCard key={`${group.id}-${board.number}`} board={board} saw={group.blade.kerfMm > 0} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function downloadPlan(plan: CuttingPlan) {
  const blob = new Blob([cuttingPlanSvg(plan)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "cutting-plans.svg";
  link.click();
  URL.revokeObjectURL(url);
}

function BoardCard({ board, saw }: { board: CutBoard; saw: boolean }) {
  return (
    <figure className="w-[320px] max-w-full">
      <div className="relative rounded-lg border border-[#1c1b18] bg-[#e7e9ee]" style={{ aspectRatio: `${board.stock.width} / ${board.stock.height}` }}>
        {board.offcuts.map((offcut) => (
          <div
            key={`${offcut.x}-${offcut.y}`}
            className="absolute bg-[#d7f0df]"
            style={boxStyle(offcut.x, offcut.y, offcut.width, offcut.height, board)}
          />
        ))}
        {board.pieces.map((piece) => (
          <Piece key={piece.id} piece={piece} board={board} saw={saw} />
        ))}
      </div>
      <figcaption className="mt-2 text-xs text-ink">
        Board {board.number} of {board.total} · {formatBoardSize(board.stock.width, board.stock.height)} · {board.usedPercent}% used
      </figcaption>
    </figure>
  );
}

function Piece({ piece, board, saw }: { piece: PlacedPiece; board: CutBoard; saw: boolean }) {
  const width = piece.rotated ? piece.height : piece.width;
  const height = piece.rotated ? piece.width : piece.height;
  const join = piece.joinCount ? ` (${piece.joinIndex} of ${piece.joinCount})` : "";
  const detail = [piece.shape ? "shaped" : "", piece.detail, join.trim()].filter(Boolean).join(" ");
  const showCode = width / board.stock.width > 0.12 && height / board.stock.height > 0.08;
  const showSize = width / board.stock.width > 0.22 && height / board.stock.height > 0.16;
  const [lx, ly] = labelPoint(piece);
  const edge = saw ? "border border-dashed border-[#c4374b]" : "border border-[#1c1b18]";
  return (
    <div
      className={`group absolute px-1 text-center ${piece.nested ? "pointer-events-none" : edge}`}
      style={{ ...boxStyle(piece.x, piece.y, width, height, board), background: piece.nested ? "transparent" : piece.shape ? "#f7f4ee" : piece.fill }}
    >
      {piece.shape ? <PieceShape piece={piece} width={width} height={height} saw={saw} /> : null}
      <span
        className="pointer-events-auto absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
        style={{ left: `${((lx - piece.x) / width) * 100}%`, top: `${((ly - piece.y) / height) * 100}%` }}
      >
        {showCode ? <span className="text-[13px] font-semibold leading-none text-[#1c1b18]">{piece.code}</span> : null}
        {showSize ? (
          <span className="mt-1 text-[10px] leading-none text-[#3d4450]">
            {Math.round(piece.width)}×{Math.round(piece.height)}
          </span>
        ) : null}
      </span>
      <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 hidden w-max max-w-56 -translate-x-1/2 rounded-lg border border-line paper px-2.5 py-1.5 text-left text-[11px] leading-4 shadow-pop group-hover:block">
        <span className="font-semibold">{piece.code}</span> {piece.partName}
        {detail ? ` · ${detail}` : ""}
        <span className="mt-0.5 block font-mono text-[10px] text-muted">
          {Math.round(piece.width)} × {Math.round(piece.height)} mm
        </span>
      </span>
    </div>
  );
}

function PieceShape({ piece, width, height, saw }: { piece: PlacedPiece; width: number; height: number; saw: boolean }) {
  const at = ([bx, by]: [number, number]) => `${bx - piece.x} ${by - piece.y}`;
  const ring = (points: [number, number][]) => `M ${points.map(at).join(" L ")} Z`;
  const shape = shapeOnBoard(piece)!;
  const d = [ring(shape.outer), ...shape.holes.map(ring)].join(" ");
  const line = piece.nested && saw ? { stroke: "#c4374b", strokeDasharray: "5 4" } : { stroke: "#1c1b18" };
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={d} fill={piece.fill} fillRule="evenodd" strokeWidth={1.25} vectorEffect="non-scaling-stroke" {...line} />
    </svg>
  );
}

function boxStyle(x: number, y: number, width: number, height: number, board: CutBoard) {
  return {
    left: `${(x / board.stock.width) * 100}%`,
    top: `${(y / board.stock.height) * 100}%`,
    width: `${(width / board.stock.width) * 100}%`,
    height: `${(height / board.stock.height) * 100}%`,
  };
}
