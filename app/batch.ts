export type CropMode = "none" | "square" | "round" | "free";

export type BatchSettings = {
  cropMode: CropMode;
  quality: number;
  outputSize: number;
};

export type SettingsOverrides = Partial<BatchSettings>;

export type ImageArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function defaultCrop(
  width: number,
  height: number,
  mode: CropMode,
): ImageArea | null {
  if (mode === "none") return null;

  if (mode === "free") {
    return {
      x: Math.round(width * 0.1),
      y: Math.round(height * 0.1),
      width: Math.round(width * 0.8),
      height: Math.round(height * 0.8),
    };
  }

  const size = Math.min(width, height);
  return {
    x: Math.round((width - size) / 2),
    y: Math.round((height - size) / 2),
    width: size,
    height: size,
  };
}

export function outputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  requestedSize: number,
  mode: CropMode,
  crop: ImageArea | null,
) {
  const area =
    mode === "none" ? { width: sourceWidth, height: sourceHeight } : crop;
  if (!area) {
    return {
      width: Math.max(1, requestedSize),
      height: Math.max(1, requestedSize),
    };
  }

  const maxSize = requestedSize || Math.max(area.width, area.height);
  const scale = maxSize / Math.max(area.width, area.height);

  return {
    width: Math.max(1, Math.round(area.width * scale)),
    height: Math.max(1, Math.round(area.height * scale)),
  };
}

export function uniqueOutputNames(names: readonly string[]) {
  const used = new Set<string>();

  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    let candidate = name;
    let copy = 2;

    while (used.has(candidate.toLowerCase())) {
      candidate = `${base}-${copy}${extension}`;
      copy += 1;
    }

    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function nextQueuedId(
  items: readonly { id: string; status: string }[],
  activeId: string | null,
) {
  if (
    activeId &&
    items.some((item) => item.id === activeId && item.status === "queued")
  ) {
    return activeId;
  }

  return items.find((item) => item.status === "queued")?.id ?? null;
}

export function imageCountLabel(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  const word =
    lastTwo >= 11 && lastTwo <= 14
      ? "изображений"
      : last === 1
        ? "изображение"
        : last >= 2 && last <= 4
          ? "изображения"
          : "изображений";

  return `${count} ${word}`;
}

export function effectiveSettings(
  defaults: BatchSettings,
  overrides: SettingsOverrides,
): BatchSettings {
  return { ...defaults, ...overrides };
}
