const PREVIEW_WIDTH = 288;
const PREVIEW_HEIGHT = 162;
const MAX_PREVIEW_LENGTH = 180_000;
const PREVIEW_TYPE = 'image/webp';
const PREVIEW_QUALITY = 0.64;

/** Copies the frame just rendered into a small canvas. Cheap and synchronous:
 * it must run in the same task as the render that filled the WebGL buffer. */
export const drawGameSavePreview = (source: HTMLCanvasElement): HTMLCanvasElement | undefined => {
  if (source.width <= 0 || source.height <= 0) return undefined;
  try {
    const preview = document.createElement('canvas');
    preview.width = PREVIEW_WIDTH;
    preview.height = PREVIEW_HEIGHT;
    const context = preview.getContext('2d', { alpha: false });
    if (!context) return undefined;

    const sourceRatio = source.width / source.height;
    const targetRatio = PREVIEW_WIDTH / PREVIEW_HEIGHT;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = source.width;
    let sourceHeight = source.height;
    if (sourceRatio > targetRatio) {
      sourceWidth = source.height * targetRatio;
      sourceX = (source.width - sourceWidth) / 2;
    } else if (sourceRatio < targetRatio) {
      sourceHeight = source.width / targetRatio;
      sourceY = (source.height - sourceHeight) / 2;
    }

    context.drawImage(
      source,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      PREVIEW_WIDTH,
      PREVIEW_HEIGHT,
    );
    return preview;
  } catch {
    return undefined;
  }
};

export const captureGameSavePreview = (source: HTMLCanvasElement): string | undefined => {
  const preview = drawGameSavePreview(source);
  if (!preview) return undefined;
  try {
    const image = preview.toDataURL(PREVIEW_TYPE, PREVIEW_QUALITY);
    return image.length <= MAX_PREVIEW_LENGTH ? image : undefined;
  } catch {
    return undefined;
  }
};

/** Same image as `captureGameSavePreview`, encoded off the main thread: a
 * synchronous WebP encode cost ~11 ms inside the gameplay frame. */
export const encodeGameSavePreview = (preview: HTMLCanvasElement): Promise<string | undefined> => new Promise(resolve => {
  try {
    preview.toBlob(blob => {
      if (!blob) { resolve(undefined); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' && reader.result.length <= MAX_PREVIEW_LENGTH ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    }, PREVIEW_TYPE, PREVIEW_QUALITY);
  } catch {
    resolve(undefined);
  }
});

/** The first WebP encode of a session initialises the encoder (~125 ms) and
 * the first copy of the WebGL canvas its readback (~20 ms). Paying both while
 * loading keeps them out of the first level-change autosave. The canvas needs
 * a real 2D context: an empty one is encoded without touching the encoder. */
export const warmGameSavePreviewEncoder = (source?: HTMLCanvasElement): void => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    context.fillRect(0, 0, 2, 2);
    if (source && source.width > 0 && source.height > 0) context.drawImage(source, 0, 0, 2, 2);
    canvas.toBlob(() => undefined, PREVIEW_TYPE, PREVIEW_QUALITY);
  } catch {
    // Previews are optional.
  }
};
