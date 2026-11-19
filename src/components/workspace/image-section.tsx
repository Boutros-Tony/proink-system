"use client";

import { ImagePlus, Plus, Trash, Upload } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { SelectField } from "@/components/workspace/fields";
import { addAssetFromFile, getAssets, getServerAssets, subscribeAssets, type StudioAsset } from "@/lib/studio/assets";
import { faceSize, freeFace, imageLayout, withImage } from "@/lib/systems/modular/images";
import { IMAGE_FACES, type ImageFace, type PartImage, type PartShape } from "@/lib/systems/modular/schema";

const FACE_LABEL: Record<ImageFace, string> = {
  front: "Front",
  back: "Back",
  left: "Left side",
  right: "Right side",
  top: "Top",
};

type PartSize = { shape: PartShape; width: number; height: number; depth: number };

/**
 * Add pictures and logos to a piece, one per face. Upload a file, drop one on the box, or reuse
 * a picture already in the library. Shown inside the Edit panel's "Images" section.
 */
export function ImagesEditor({
  part,
  images,
  onChange,
}: {
  part: PartSize;
  images: PartImage[];
  /** `key` joins quick repeated edits, like dragging a slider, into one undo step. */
  onChange: (images: PartImage[], key?: string) => void;
}) {
  const library = useSyncExternalStore(subscribeAssets, getAssets, getServerAssets);
  const cylinder = part.shape === "cylinder";
  const faces: readonly ImageFace[] = cylinder ? ["front"] : IMAGE_FACES;
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const canAdd = images.length < faces.length;
  const showChooser = canAdd && (images.length === 0 || choosing);

  function place(asset: StudioAsset) {
    onChange(withImage(images, { assetId: asset.id, face: freeFace(images, faces), fit: "contain" }));
    setChoosing(false);
    setError(null);
  }

  async function upload(files: Iterable<File>) {
    const file = [...files].find((item) => item.type.startsWith("image/"));
    if (!file) {
      setError("Choose a PNG, JPG, SVG, or WebP picture.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      place(await addAssetFromFile(file));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That picture could not be added.");
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setOver(false);
    void upload(event.dataTransfer.files);
  }

  function update(face: ImageFace, changes: Partial<PartImage>, key?: string) {
    onChange(
      images.map((image) => ((image.face ?? "front") === face ? { ...image, ...changes } : image)),
      key ? `image:${face}:${key}` : undefined,
    );
  }

  function moveToFace(from: ImageFace, to: ImageFace) {
    if (from === to) return;
    onChange(images.filter((image) => (image.face ?? "front") !== to).map((image) => ((image.face ?? "front") === from ? { ...image, face: to } : image)));
  }

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload a picture"
        onChange={(event) => {
          void upload(event.target.files ?? []);
          event.target.value = "";
        }}
      />

      {images.map((image) => {
        const face = image.face ?? "front";
        const asset = library.find((item) => item.id === image.assetId);
        const fit = image.fit ?? "contain";
        const layout = asset ? imageLayout(part, image, asset.width / asset.height) : null;
        const taken = new Set(images.map((item) => item.face ?? "front"));
        return (
          <div key={face} className="rounded-xl border border-line bg-panel p-2.5 shadow-soft">
            <div className="flex items-center gap-2.5">
              <Thumb asset={asset} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-ink">{asset?.name ?? "Picture missing"}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
                  {asset ? (layout ? `prints ${Math.round(layout.width)} × ${Math.round(layout.height)} mm` : "") : "Upload it again to see it"}
                </p>
              </div>
              <button
                type="button"
                title="Remove picture"
                aria-label="Remove picture"
                onClick={() => onChange(images.filter((item) => (item.face ?? "front") !== face))}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <Trash size={14} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {cylinder ? (
                <p className="flex items-center rounded-lg bg-raised px-2.5 text-xs text-muted">Around the side</p>
              ) : (
                <SelectField
                  compact
                  aria-label="Face"
                  value={face}
                  onChange={(event) => moveToFace(face, event.target.value as ImageFace)}
                >
                  {IMAGE_FACES.map((option) => (
                    <option key={option} value={option} disabled={option !== face && taken.has(option)}>
                      {FACE_LABEL[option]}
                      {option !== face && taken.has(option) ? " (used)" : ""}
                    </option>
                  ))}
                </SelectField>
              )}
              <div className="inline-flex rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="Fit">
                {(["contain", "cover"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={fit === option}
                    title={option === "contain" ? "Keep the whole picture visible, good for logos" : "Fill the whole face and crop the edges, good for photos"}
                    onClick={() => update(face, { fit: option })}
                    className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${fit === option ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}
                  >
                    {option === "contain" ? "Logo" : "Fill"}
                  </button>
                ))}
              </div>
            </div>

            {fit === "contain" ? (
              <div className="mt-2.5 space-y-1.5">
                <Slider label="Size" min={5} max={100} value={Math.round((image.scale ?? 1) * 100)} suffix="%" onChange={(value) => update(face, { scale: value / 100 }, "scale")} />
                <Slider label="Left / right" min={-50} max={50} value={Math.round((image.x ?? 0) * 100)} onChange={(value) => update(face, { x: value / 100 }, "x")} />
                <Slider label="Up / down" min={-50} max={50} value={Math.round((image.y ?? 0) * 100)} onChange={(value) => update(face, { y: value / 100 }, "y")} />
              </div>
            ) : (
              <p className="mt-2 text-[11px] leading-4 text-subtle">
                Fills {Math.round(faceSize(part, face).width)} × {Math.round(faceSize(part, face).height)} mm. The edges that do not fit are cropped.
              </p>
            )}
          </div>
        );
      })}

      {showChooser ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={`rounded-xl border border-dashed p-3 transition-colors ${over ? "border-accent bg-accent-soft" : "border-line-strong bg-panel"}`}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="flex w-full flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center transition-colors hover:bg-raised disabled:opacity-60"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
              {busy ? <Upload size={17} strokeWidth={1.9} aria-hidden="true" className="animate-pulse" /> : <ImagePlus size={17} strokeWidth={1.9} aria-hidden="true" />}
            </span>
            <span className="text-[13px] font-semibold text-ink">{busy ? "Preparing picture" : "Add an image or logo"}</span>
            <span className="text-[11px] leading-4 text-muted">Click to upload, or drop a file here. PNG with a clear background works best for logos.</span>
          </button>
          {library.length > 0 ? (
            <div className="mt-2.5 border-t border-line pt-2.5">
              <p className="eyebrow pb-2">Or reuse one</p>
              <ul className="grid grid-cols-4 gap-2">
                {library.map((asset) => (
                  <li key={asset.id}>
                    <button
                      type="button"
                      title={asset.name}
                      aria-label={`Use ${asset.name}`}
                      onClick={() => place(asset)}
                      className="block aspect-square w-full overflow-hidden rounded-lg border border-line bg-raised transition-all hover:border-accent hover:shadow-float"
                    >
                      <Thumb asset={asset} fill />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {images.length > 0 ? (
            <button type="button" onClick={() => setChoosing(false)} className="mt-2 w-full rounded-lg py-1.5 text-xs font-medium text-muted hover:bg-raised hover:text-ink">
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {canAdd && images.length > 0 && !choosing ? (
        <button
          type="button"
          onClick={() => setChoosing(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-panel px-2.5 py-2 text-xs font-medium text-ink shadow-soft transition-colors hover:bg-raised"
        >
          <Plus size={13} strokeWidth={2} aria-hidden="true" />
          Add another image
        </button>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-2.5 py-2 text-xs leading-5 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Thumb({ asset, fill = false }: { asset: StudioAsset | undefined; fill?: boolean }) {
  if (!asset) {
    return <span className={`flex shrink-0 items-center justify-center rounded-lg bg-raised text-subtle ${fill ? "h-full w-full" : "h-11 w-11"}`}>?</span>;
  }
  return (
    <span
      className={`shrink-0 overflow-hidden rounded-lg border border-line bg-[linear-gradient(45deg,#eceef5_25%,transparent_25%,transparent_75%,#eceef5_75%),linear-gradient(45deg,#eceef5_25%,#fff_25%,#fff_75%,#eceef5_75%)] bg-[length:10px_10px] bg-[position:0_0,5px_5px] ${fill ? "block h-full w-full border-0" : "h-11 w-11"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL, nothing for next/image to optimize */}
      <img src={asset.dataUrl} alt="" className="h-full w-full object-contain" draggable={false} />
    </span>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 text-xs text-muted">
      <span className="w-[72px] shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-accent"
      />
      <span className="w-9 shrink-0 text-right font-mono text-[11px] text-ink">
        {value}
        {suffix}
      </span>
    </label>
  );
}
