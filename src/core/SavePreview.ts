const PREVIEW_WIDTH = 288;
const PREVIEW_HEIGHT = 162;
const MAX_PREVIEW_LENGTH = 180_000;

export const captureGameSavePreview = (source: HTMLCanvasElement): string | undefined => {
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
    const image = preview.toDataURL('image/webp', 0.64);
    return image.length <= MAX_PREVIEW_LENGTH ? image : undefined;
  } catch {
    return undefined;
  }
};
