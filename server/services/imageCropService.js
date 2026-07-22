const { Jimp } = require('jimp');
const { fetchImageBuffer } = require('./safeImageFetch');

const COLOR_TOLERANCE = 18; // max per-channel diff to treat a pixel as matching the background color
const ALPHA_TRANSPARENT_THRESHOLD = 10; // alpha at/below this counts as transparent background
const ROW_BACKGROUND_RATIO = 0.985; // fraction of a row/column that must be background to trim it
const BORDER_SAMPLE_STEP = 3; // stride when sampling the border to detect the background color
const BORDER_UNIFORMITY_RATIO = 0.9; // fraction of border samples that must agree for a color to count as "the" background
const MIN_MARGIN_RATIO = 0.02; // skip cropping if the largest detected margin is already this small
const PADDING_RATIO = 0.06; // padding re-added around the detected subject, relative to its size
const MIN_IMAGE_DIMENSION = 20; // images smaller than this aren't worth analyzing
const JPEG_QUALITY = 90;

function pixelAt(data, width, x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] };
}

function colorDistance(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

function detectHasTransparency(data) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] <= 250) return true;
  }
  return false;
}

// Looks at a stride-sampled ring around the border for a single dominant
// opaque color. Returns null when the border isn't uniform enough (a busy
// or lifestyle-photo background), which signals the caller to leave the
// image untouched rather than force a crop.
function detectBackgroundColor(data, width, height) {
  const samples = [];
  for (let x = 0; x < width; x += BORDER_SAMPLE_STEP) {
    samples.push(pixelAt(data, width, x, 0));
    samples.push(pixelAt(data, width, x, height - 1));
  }
  for (let y = 0; y < height; y += BORDER_SAMPLE_STEP) {
    samples.push(pixelAt(data, width, 0, y));
    samples.push(pixelAt(data, width, width - 1, y));
  }

  const opaqueSamples = samples.filter((s) => s.a > ALPHA_TRANSPARENT_THRESHOLD);
  if (opaqueSamples.length < samples.length * 0.5) return null;

  const candidate = opaqueSamples[0];
  const agreeing = opaqueSamples.filter((s) => colorDistance(s, candidate) <= COLOR_TOLERANCE).length;
  if (agreeing / opaqueSamples.length < BORDER_UNIFORMITY_RATIO) return null;
  return candidate;
}

function isBackgroundPixel(pixel, bgColor) {
  if (pixel.a <= ALPHA_TRANSPARENT_THRESHOLD) return true;
  if (bgColor && colorDistance(pixel, bgColor) <= COLOR_TOLERANCE) return true;
  return false;
}

function isRowBackground(data, width, y, bgColor) {
  let bgCount = 0;
  for (let x = 0; x < width; x++) {
    if (isBackgroundPixel(pixelAt(data, width, x, y), bgColor)) bgCount++;
  }
  return bgCount / width >= ROW_BACKGROUND_RATIO;
}

function isColBackground(data, width, top, bottom, x, bgColor) {
  let bgCount = 0;
  const span = bottom - top + 1;
  for (let y = top; y <= bottom; y++) {
    if (isBackgroundPixel(pixelAt(data, width, x, y), bgColor)) bgCount++;
  }
  return bgCount / span >= ROW_BACKGROUND_RATIO;
}

// Scans inward from each of the four edges to find the tight bounding box
// of non-background content. Returns null when no content is detected
// (e.g. a blank swatch).
function findContentBox(data, width, height, bgColor) {
  let top = 0;
  while (top < height && isRowBackground(data, width, top, bgColor)) top++;
  if (top >= height) return null;

  let bottom = height - 1;
  while (bottom > top && isRowBackground(data, width, bottom, bgColor)) bottom--;

  let left = 0;
  while (left < width && isColBackground(data, width, top, bottom, left, bgColor)) left++;
  if (left >= width) return null;

  let right = width - 1;
  while (right > left && isColBackground(data, width, top, bottom, right, bgColor)) right--;

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

// If the image has a uniform solid-color or transparent border, crops it
// tightly around the product with a small padding margin. Returns null
// (never throws) whenever a crop can't be produced or wouldn't help —
// caller should just fall back to the original image in that case.
async function cropBuffer(buffer) {
  try {
    const image = await Jimp.read(buffer);
    const { width, height, data } = image.bitmap;
    if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) return null;

    const hasTransparency = detectHasTransparency(data);
    const bgColor = detectBackgroundColor(data, width, height);
    if (!bgColor && !hasTransparency) return null;

    const box = findContentBox(data, width, height, bgColor);
    if (!box) return null;

    const topMargin = box.y;
    const bottomMargin = height - (box.y + box.height);
    const leftMargin = box.x;
    const rightMargin = width - (box.x + box.width);
    const maxMarginRatio = Math.max(
      topMargin / height,
      bottomMargin / height,
      leftMargin / width,
      rightMargin / width
    );
    if (maxMarginRatio < MIN_MARGIN_RATIO) return null;

    const pad = Math.round(PADDING_RATIO * Math.max(box.width, box.height));
    const cropX = Math.max(0, box.x - pad);
    const cropY = Math.max(0, box.y - pad);
    const cropRight = Math.min(width, box.x + box.width + pad);
    const cropBottom = Math.min(height, box.y + box.height + pad);
    const cropW = cropRight - cropX;
    const cropH = cropBottom - cropY;
    if (cropW >= width && cropH >= height) return null;

    image.crop({ x: cropX, y: cropY, w: cropW, h: cropH });

    const mimeType = hasTransparency ? 'image/png' : 'image/jpeg';
    const outBuffer = mimeType === 'image/jpeg'
      ? await image.getBuffer('image/jpeg', { quality: JPEG_QUALITY })
      : await image.getBuffer('image/png');
    return { buffer: outBuffer, mimeType };
  } catch {
    return null;
  }
}

// Downloads the image at imageUrl and delegates to cropBuffer.
async function autoCropProductImage(imageUrl) {
  const buffer = await fetchImageBuffer(imageUrl);
  if (!buffer) return null;
  return cropBuffer(buffer);
}

module.exports = { autoCropProductImage, cropBuffer };
