"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Cropper, { type Area, type Point, type Size } from "react-easy-crop";
import ReactCrop, {
  type PercentCrop,
  type PixelCrop,
} from "react-image-crop";
import {
  defaultCrop,
  imageCountLabel,
  nextQueuedId,
  uniqueOutputNames,
  type CropMode,
} from "./batch";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_FILES = 30;
const OUTPUT_SIZES = [256, 512, 1024, 2048];
const DEFAULT_FREE_CROP: PercentCrop = {
  unit: "%",
  x: 10,
  y: 10,
  width: 80,
  height: 80,
};

type ItemStatus = "waiting" | "queued" | "processing" | "ready" | "error";

type BatchItem = {
  id: string;
  file: File;
  sourceUrl: string;
  width: number;
  height: number;
  crop: Point;
  zoom: number;
  freeCrop: PercentCrop;
  croppedArea: Area | null;
  outputBlob: Blob | null;
  outputUrl: string;
  status: ItemStatus;
  error: string;
  revision: number;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 ** 2).toFixed(2)} МБ`;
}

function outputName(name: string, mode: CropMode) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  const suffix = mode === "none" ? "" : `-${mode}`;
  return `${base}${suffix}.webp`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось прочитать изображение"));
    image.src = src;
  });
}

function getOutputSize(size: number, mode: CropMode, crop: Area | null): Size {
  if (mode !== "free" || !crop) return { width: size, height: size };

  const scale = size / Math.max(crop.width, crop.height);
  return {
    width: Math.max(1, Math.round(crop.width * scale)),
    height: Math.max(1, Math.round(crop.height * scale)),
  };
}

async function renderWebp(
  imageSrc: string,
  crop: Area | null,
  requestedSize: number,
  quality: number,
  mode: CropMode,
) {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  const isUncropped = mode === "none";

  if (isUncropped) {
    const scale =
      requestedSize / Math.max(image.naturalWidth, image.naturalHeight);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  } else {
    const outputSize = getOutputSize(requestedSize, mode, crop);
    canvas.width = outputSize.width;
    canvas.height = outputSize.height;
  }

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas недоступен в этом браузере");

  if (mode === "round") {
    context.beginPath();
    context.arc(
      requestedSize / 2,
      requestedSize / 2,
      requestedSize / 2,
      0,
      Math.PI * 2,
    );
    context.clip();
  }

  if (isUncropped) {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } else {
    if (!crop) throw new Error("Сначала выставьте кадр");
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("WebP не поддерживается этим браузером")),
      "image/webp",
      quality,
    );
  });
}

function statusLabel(item: BatchItem) {
  if (item.status === "processing") return "Обработка";
  if (item.status === "waiting") return "Ожидает";
  if (item.status === "queued") return "В очереди";
  if (item.status === "error") return "Ошибка";
  return "Готово";
}

export default function Home() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState<CropMode>("none");
  const [quality, setQuality] = useState(82);
  const [outputSize, setOutputSize] = useState(1024);
  const [cropSize, setCropSize] = useState<Size | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const itemsRef = useRef<BatchItem[]>([]);
  const revisionRef = useRef(0);
  const freeImageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(
    () => () => {
      itemsRef.current.forEach((item) => {
        if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
        if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
      });
    },
    [],
  );

  const activeItem =
    items.find((item) => item.id === activeId) ?? items[0] ?? null;
  const validItems = useMemo(
    () => items.filter((item) => item.sourceUrl),
    [items],
  );
  const readyItems = validItems.filter((item) => item.status === "ready");
  const totalInputSize = validItems.reduce(
    (total, item) => total + item.file.size,
    0,
  );
  const totalOutputSize = readyItems.reduce(
    (total, item) => total + (item.outputBlob?.size ?? 0),
    0,
  );
  const allReady =
    validItems.length > 0 && readyItems.length === validItems.length;
  const activeExporting =
    activeItem?.status === "waiting" ||
    activeItem?.status === "queued" ||
    activeItem?.status === "processing";

  const markAllWaiting = useCallback(() => {
    const revision = ++revisionRef.current;
    setItems((current) =>
      current.map((item) =>
        item.sourceUrl
          ? { ...item, status: "waiting", error: "", revision }
          : item,
      ),
    );
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(
      () =>
        setItems((current) =>
          current.map((item) =>
            item.status === "waiting" ? { ...item, status: "queued" } : item,
          ),
        ),
      280,
    );
    return () => window.clearTimeout(timeout);
  }, [outputSize, quality]);

  const addFiles = useCallback(
    async (files: readonly File[]) => {
      if (!files.length) return;
      setBusy(true);
      setError("");

      const capacity = Math.max(0, MAX_FILES - itemsRef.current.length);
      const selected = files.slice(0, capacity);
      if (selected.length < files.length) {
        setError(`Можно обработать не больше ${MAX_FILES} файлов за раз.`);
      }

      const revision = ++revisionRef.current;
      const prepared: BatchItem[] = [];

      for (const file of selected) {
        const extension = file.name.split(".").pop()?.toLowerCase();
        const supported =
          file.type.startsWith("image/") ||
          extension === "heic" ||
          extension === "heif";
        const baseItem = {
          id: crypto.randomUUID(),
          file,
          sourceUrl: "",
          width: 0,
          height: 0,
          crop: { x: 0, y: 0 },
          zoom: 1,
          freeCrop: { ...DEFAULT_FREE_CROP },
          croppedArea: null,
          outputBlob: null,
          outputUrl: "",
          revision,
        };

        if (file.size > MAX_FILE_SIZE || !supported) {
          prepared.push({
            ...baseItem,
            status: "error",
            error:
              file.size > MAX_FILE_SIZE
                ? "Файл больше 50 МБ"
                : "Неподдерживаемый формат",
          });
          continue;
        }

        let nextUrl = "";
        try {
          let preview: Blob = file;
          const isHeic =
            extension === "heic" ||
            extension === "heif" ||
            /hei[cf]/i.test(file.type);

          if (isHeic) {
            const { heicTo } = await import("heic-to");
            preview = await heicTo({
              blob: file,
              type: "image/jpeg",
              quality: 0.95,
            });
          }

          nextUrl = URL.createObjectURL(preview);
          const image = await loadImage(nextUrl);
          prepared.push({
            ...baseItem,
            sourceUrl: nextUrl,
            width: image.naturalWidth,
            height: image.naturalHeight,
            croppedArea: defaultCrop(
              image.naturalWidth,
              image.naturalHeight,
              cropMode,
            ),
            status: "queued",
            error: "",
          });
        } catch (caught) {
          if (nextUrl) URL.revokeObjectURL(nextUrl);
          prepared.push({
            ...baseItem,
            status: "error",
            error:
              caught instanceof Error
                ? caught.message
                : "Не удалось обработать изображение",
          });
        }
      }

      setItems((current) => [...current, ...prepared]);
      setActiveId(
        (current) =>
          current ??
          prepared.find((item) => item.sourceUrl)?.id ??
          prepared[0]?.id ??
          null,
      );
      setBusy(false);
    },
    [cropMode],
  );

  useEffect(() => {
    if (processingId) return;

    const nextId = nextQueuedId(items, activeId);
    if (!nextId) return;
    const item = items.find((candidate) => candidate.id === nextId);
    if (!item?.sourceUrl) return;

    const revision = item.revision;
    const sourceUrl = item.sourceUrl;
    const area = item.croppedArea;
    setProcessingId(nextId);
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === nextId && candidate.revision === revision
          ? { ...candidate, status: "processing" }
          : candidate,
      ),
    );

    void renderWebp(
      sourceUrl,
      area,
      outputSize,
      quality / 100,
      cropMode,
    )
      .then((blob) => {
        const nextUrl = URL.createObjectURL(blob);
        setItems((current) => {
          const currentItem = current.find(
            (candidate) => candidate.id === nextId,
          );
          if (!currentItem || currentItem.revision !== revision) {
            URL.revokeObjectURL(nextUrl);
            return current;
          }

          if (currentItem.outputUrl) {
            URL.revokeObjectURL(currentItem.outputUrl);
          }
          return current.map((candidate) =>
            candidate.id === nextId
              ? {
                  ...candidate,
                  outputBlob: blob,
                  outputUrl: nextUrl,
                  status: "ready",
                  error: "",
                }
              : candidate,
          );
        });
      })
      .catch((caught) => {
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === nextId && candidate.revision === revision
              ? {
                  ...candidate,
                  status: "error",
                  error:
                    caught instanceof Error
                      ? caught.message
                      : "Не удалось создать WebP",
                }
              : candidate,
          ),
        );
      })
      .finally(() => {
        setProcessingId((current) => (current === nextId ? null : current));
      });
  }, [activeId, cropMode, items, outputSize, processingId, quality]);

  const updateActive = useCallback(
    (change: Partial<BatchItem>) => {
      if (!activeId) return;
      setItems((current) =>
        current.map((item) =>
          item.id === activeId ? { ...item, ...change } : item,
        ),
      );
    },
    [activeId],
  );

  const queueActiveCrop = useCallback(
    (area: Area) => {
      if (!activeId) return;
      const revision = ++revisionRef.current;
      setItems((current) =>
        current.map((item) =>
          item.id === activeId
            ? {
                ...item,
                croppedArea: area,
                status: "queued",
                error: "",
                revision,
              }
            : item,
        ),
      );
    },
    [activeId],
  );

  const onCropComplete = useCallback(
    (_: Area, areaPixels: Area) => queueActiveCrop(areaPixels),
    [queueActiveCrop],
  );

  const onFreeCropComplete = useCallback(
    (nextCrop: PixelCrop) => {
      const image = freeImageRef.current;
      if (!image || !nextCrop.width || !nextCrop.height) return;

      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;
      queueActiveCrop({
        x: Math.round(nextCrop.x * scaleX),
        y: Math.round(nextCrop.y * scaleY),
        width: Math.round(nextCrop.width * scaleX),
        height: Math.round(nextCrop.height * scaleY),
      });
    },
    [queueActiveCrop],
  );

  const initializeFreeCrop = useCallback(
    (image: HTMLImageElement) => {
      const nextCrop = activeItem?.freeCrop ?? DEFAULT_FREE_CROP;
      queueActiveCrop({
        x: Math.round((image.naturalWidth * nextCrop.x) / 100),
        y: Math.round((image.naturalHeight * nextCrop.y) / 100),
        width: Math.round((image.naturalWidth * nextCrop.width) / 100),
        height: Math.round((image.naturalHeight * nextCrop.height) / 100),
      });
    },
    [activeItem?.freeCrop, queueActiveCrop],
  );

  const resetActiveFrame = useCallback(() => {
    if (!activeItem?.sourceUrl) return;
    const revision = ++revisionRef.current;
    setItems((current) =>
      current.map((item) =>
        item.id === activeItem.id
          ? {
              ...item,
              crop: { x: 0, y: 0 },
              zoom: 1,
              freeCrop: { ...DEFAULT_FREE_CROP },
              croppedArea: defaultCrop(item.width, item.height, cropMode),
              status: "queued",
              error: "",
              revision,
            }
          : item,
      ),
    );
  }, [activeItem, cropMode]);

  const changeCropMode = useCallback((mode: CropMode) => {
    const revision = ++revisionRef.current;
    setCropMode(mode);
    setCropSize(null);
    setItems((current) =>
      current.map((item) =>
        item.sourceUrl
          ? {
              ...item,
              crop: { x: 0, y: 0 },
              zoom: 1,
              freeCrop: { ...DEFAULT_FREE_CROP },
              croppedArea: defaultCrop(item.width, item.height, mode),
              status: "queued",
              error: "",
              revision,
            }
          : item,
      ),
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    const removed = itemsRef.current.find((item) => item.id === id);
    if (!removed) return;
    if (removed.sourceUrl) URL.revokeObjectURL(removed.sourceUrl);
    if (removed.outputUrl) URL.revokeObjectURL(removed.outputUrl);

    const remaining = itemsRef.current.filter((item) => item.id !== id);
    itemsRef.current = remaining;
    setItems(remaining);
    setActiveId((current) =>
      current === id
        ? (remaining.find((item) => item.sourceUrl)?.id ??
          remaining[0]?.id ??
          null)
        : current,
    );
  }, []);

  const clear = useCallback(() => {
    itemsRef.current.forEach((item) => {
      if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    });
    itemsRef.current = [];
    setItems([]);
    setActiveId(null);
    setError("");
    setProcessingId(null);
  }, []);

  const downloadCurrent = useCallback(() => {
    if (!activeItem?.outputUrl || activeItem.status !== "ready") return;
    const link = document.createElement("a");
    link.href = activeItem.outputUrl;
    link.download = outputName(activeItem.file.name, cropMode);
    link.click();
    link.remove();
  }, [activeItem, cropMode]);

  const downloadAll = useCallback(async () => {
    const downloadable = itemsRef.current.filter(
      (item) => item.status === "ready" && item.outputBlob,
    );
    if (!downloadable.length || downloadable.length !== validItems.length) {
      return;
    }

    setDownloadingZip(true);
    setError("");
    try {
      const { downloadZip } = await import("client-zip");
      const names = uniqueOutputNames(
        downloadable.map((item) => outputName(item.file.name, cropMode)),
      );
      const blob = await downloadZip(
        downloadable.map((item, index) => ({
          name: names[index],
          lastModified: new Date(item.file.lastModified),
          input: item.outputBlob!,
        })),
      ).blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "webp-images.zip";
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Не удалось собрать ZIP. Скачайте изображения по одному.");
    } finally {
      setDownloadingZip(false);
    }
  }, [cropMode, validItems.length]);

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Быстрый WebP — на главную">
          <span className="brand-mark" aria-hidden="true" />
          Быстрый WebP
        </Link>
        <span className="privacy">
          <span aria-hidden="true">●</span> Фото остаются в браузере
        </span>
      </header>

      <section className="workspace">
        <div className="workspace-title">
          <div>
            <p className="eyebrow">Конвертация в браузере</p>
            <h1>
              {items.length > 1 ? imageCountLabel(items.length) : "Подготовьте WebP"}
            </h1>
          </div>
          {items.length > 0 && (
            <div className="workspace-actions">
              <label className="text-button file-picker">
                Добавить фото
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
                  onChange={(event) => {
                    void addFiles([...(event.target.files ?? [])]);
                    event.target.value = "";
                  }}
                />
              </label>
              <button className="text-button" type="button" onClick={clear}>
                Очистить
              </button>
            </div>
          )}
        </div>

        <div className="editor-grid">
          {items.length === 0 ? (
            <label
              className={`editor-card dropzone editor-dropzone ${
                dragging ? "is-dragging" : ""
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void addFiles([...event.dataTransfer.files]);
              }}
            >
              <input
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(event) =>
                  void addFiles([...(event.target.files ?? [])])
                }
              />
              <span className="upload-icon" aria-hidden="true">
                +
              </span>
              <strong>
                {busy ? "Читаем изображения…" : "Выбрать изображения"}
              </strong>
              <span>или перетащите их сюда</span>
              <small>JPG, PNG, WebP, HEIC · до 30 файлов · 50 МБ каждый</small>
            </label>
          ) : (
            <div className="editor-card">
              {activeItem?.sourceUrl ? (
                <div
                  className={`cropper-wrap ${
                    cropMode === "none" ? "is-uncropped" : ""
                  }`}
                >
                  {cropMode === "none" ? (
                    <div className="uncropped-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={
                          showOriginal ||
                          activeItem.status !== "ready" ||
                          !activeItem.outputUrl
                            ? activeItem.sourceUrl
                            : activeItem.outputUrl
                        }
                        alt="Предпросмотр изображения целиком"
                      />
                      {activeItem.outputUrl &&
                        activeItem.status === "ready" &&
                        !showOriginal &&
                        <span>WebP · {quality}%</span>}
                    </div>
                  ) : cropMode === "free" ? (
                    <div className="free-crop-preview">
                      <ReactCrop
                        crop={activeItem.freeCrop}
                        keepSelection
                        minWidth={40}
                        minHeight={40}
                        onChange={(_, percentCrop) =>
                          updateActive({ freeCrop: percentCrop })
                        }
                        onComplete={onFreeCropComplete}
                        onDragStart={() => setInteracting(true)}
                        onDragEnd={() => setInteracting(false)}
                        renderSelectionAddon={() =>
                          activeItem.outputUrl &&
                          activeItem.status === "ready" ? (
                            <div
                              className={`free-webp-overlay ${
                                interacting ||
                                showOriginal ||
                                activeExporting
                                  ? "is-hidden"
                                  : ""
                              }`}
                              aria-hidden="true"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={activeItem.outputUrl} alt="" />
                              <span>WebP · {quality}%</span>
                            </div>
                          ) : null
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          ref={freeImageRef}
                          src={activeItem.sourceUrl}
                          alt="Изображение со свободной рамкой кадрирования"
                          onLoad={(event) =>
                            initializeFreeCrop(event.currentTarget)
                          }
                        />
                      </ReactCrop>
                    </div>
                  ) : (
                    <>
                      <Cropper
                        key={`${activeItem.id}-${cropMode}`}
                        image={activeItem.sourceUrl}
                        crop={activeItem.crop}
                        zoom={activeItem.zoom}
                        aspect={1}
                        cropShape={cropMode === "round" ? "round" : "rect"}
                        showGrid={false}
                        onCropChange={(crop) => updateActive({ crop })}
                        onZoomChange={(zoom) => updateActive({ zoom })}
                        onCropComplete={onCropComplete}
                        onCropSizeChange={setCropSize}
                        onInteractionStart={() => setInteracting(true)}
                        onInteractionEnd={() => setInteracting(false)}
                      />
                      {activeItem.outputUrl &&
                        activeItem.status === "ready" &&
                        cropSize && (
                        <div
                          className={`webp-overlay ${
                            cropMode === "round" ? "is-round" : ""
                          } ${
                            interacting || showOriginal || activeExporting
                              ? "is-hidden"
                              : ""
                          }`}
                          style={{
                            width: cropSize.width,
                            height: cropSize.height,
                          }}
                          aria-hidden="true"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={activeItem.outputUrl} alt="" />
                          <span>WebP · {quality}%</span>
                        </div>
                        )}
                    </>
                  )}
                </div>
              ) : (
                <div className="file-error-preview" role="alert">
                  <strong>{activeItem?.file.name}</strong>
                  <span>{activeItem?.error}</span>
                  <button
                    type="button"
                    onClick={() => activeItem && removeItem(activeItem.id)}
                  >
                    Удалить файл
                  </button>
                </div>
              )}

              <div className="editor-hint">
                <span>
                  {activeExporting
                    ? "Обновляем WebP…"
                    : activeItem?.status === "error"
                      ? activeItem.error
                      : cropMode === "free"
                        ? "Тяните углы или стороны рамки"
                        : cropMode === "none"
                          ? "Изображение экспортируется целиком"
                          : `Перетаскивайте фото внутри ${
                              cropMode === "round" ? "круга" : "квадрата"
                            }`}
                </span>
                {activeItem?.sourceUrl && (
                  <div>
                    <button
                      type="button"
                      onPointerDown={() => setShowOriginal(true)}
                      onPointerUp={() => setShowOriginal(false)}
                      onPointerCancel={() => setShowOriginal(false)}
                      onPointerLeave={() => setShowOriginal(false)}
                      onKeyDown={(event) => {
                        if (event.key === " " || event.key === "Enter") {
                          setShowOriginal(true);
                        }
                      }}
                      onKeyUp={() => setShowOriginal(false)}
                      onBlur={() => setShowOriginal(false)}
                    >
                      Зажмите: исходник
                    </button>
                    {cropMode !== "none" && (
                      <button type="button" onClick={resetActiveFrame}>
                        По центру
                      </button>
                    )}
                  </div>
                )}
              </div>

              {items.length > 1 && (
                <div className="file-strip" aria-label="Добавленные изображения">
                  {items.map((item) => (
                    <div
                      className={`file-thumb ${
                        item.id === activeItem?.id ? "is-active" : ""
                      }`}
                      key={item.id}
                    >
                      <button
                        className="file-select"
                        type="button"
                        onClick={() => {
                          setActiveId(item.id);
                          setCropSize(null);
                        }}
                        aria-label={`${item.file.name}: ${statusLabel(item)}`}
                        title={item.file.name}
                      >
                        {item.sourceUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.sourceUrl} alt="" />
                        ) : (
                          <span className="file-placeholder" aria-hidden="true">
                            !
                          </span>
                        )}
                        <span className={`file-status is-${item.status}`}>
                          {statusLabel(item)}
                        </span>
                      </button>
                      <button
                        className="file-remove"
                        type="button"
                        aria-label={`Удалить ${item.file.name}`}
                        onClick={() => removeItem(item.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <aside className="controls-card">
            <div className="file-row">
              <div>
                <span>
                  {validItems.length > 1 ? "Выбрано" : "Исходник"}
                </span>
                <strong title={activeItem?.file.name}>
                  {activeItem?.file.name ?? "Файл не выбран"}
                </strong>
              </div>
              <b>{activeItem ? formatBytes(activeItem.file.size) : "—"}</b>
            </div>

            <div className="mode-control">
              <span>
                Форма
                {validItems.length > 1 && <b>для всех</b>}
              </span>
              <div className="mode-tabs" role="group" aria-label="Форма WebP">
                {(
                  [
                    ["none", "Без обрезки"],
                    ["square", "Квадрат"],
                    ["round", "Круг"],
                    ["free", "Свободная"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    className={cropMode === mode ? "is-active" : ""}
                    type="button"
                    aria-pressed={cropMode === mode}
                    disabled={!validItems.length}
                    onClick={() => changeCropMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {cropMode !== "none" && cropMode !== "free" && (
              <label className="control">
                <span>
                  Масштаб <b>{activeItem?.zoom.toFixed(1) ?? "1.0"}×</b>
                </span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  disabled={!activeItem?.sourceUrl}
                  value={activeItem?.zoom ?? 1}
                  onChange={(event) =>
                    updateActive({ zoom: Number(event.target.value) })
                  }
                />
              </label>
            )}

            <label className="control">
              <span>
                Качество WebP <b>{quality}%</b>
              </span>
              <input
                type="range"
                min="35"
                max="100"
                step="1"
                disabled={!validItems.length}
                value={quality}
                onChange={(event) => {
                  setQuality(Number(event.target.value));
                  markAllWaiting();
                }}
              />
            </label>

            <label className="control">
              <span>
                {cropMode === "none" ? "Максимальная сторона" : "Размер"}
                {validItems.length > 1 && <b>для всех</b>}
              </span>
              <select
                disabled={!validItems.length}
                value={outputSize}
                onChange={(event) => {
                  setOutputSize(Number(event.target.value));
                  markAllWaiting();
                }}
              >
                {OUTPUT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {cropMode === "none"
                      ? `${size} px`
                      : `${getOutputSize(size, cropMode, activeItem?.croppedArea ?? null).width} × ${
                          getOutputSize(
                            size,
                            cropMode,
                            activeItem?.croppedArea ?? null,
                          ).height
                        } px`}
                  </option>
                ))}
              </select>
            </label>

            <div className="result">
              <div>
                <span>
                  {validItems.length > 1
                    ? "Готовая пачка"
                    : "Готовый WebP"}
                </span>
                <strong>
                  {!validItems.length
                    ? "—"
                    : !allReady
                      ? `${readyItems.length} из ${validItems.length} готово`
                      : validItems.length > 1
                        ? `${formatBytes(totalInputSize)} → ${formatBytes(totalOutputSize)}`
                        : formatBytes(totalOutputSize)}
                </strong>
                {allReady && (
                  <small>
                    {totalOutputSize < totalInputSize
                      ? `На ${Math.round((1 - totalOutputSize / totalInputSize) * 100)}% легче`
                      : "Размер вырос из-за выбранных настроек"}
                  </small>
                )}
              </div>
            </div>

            {(error || activeItem?.status === "error") && (
              <p className="error" role="alert">
                {error || activeItem?.error}
              </p>
            )}

            {validItems.length > 1 && (
              <button
                className="download secondary-download"
                type="button"
                disabled={
                  !activeItem?.outputBlob || activeItem.status !== "ready"
                }
                onClick={downloadCurrent}
              >
                Скачать выбранное
                <span aria-hidden="true">↓</span>
              </button>
            )}

            <button
              className="download"
              type="button"
              disabled={
                validItems.length > 1
                  ? !allReady || downloadingZip
                  : !activeItem?.outputBlob || activeItem.status !== "ready"
              }
              onClick={
                validItems.length > 1 ? () => void downloadAll() : downloadCurrent
              }
            >
              {validItems.length > 1
                ? downloadingZip
                  ? "Собираем ZIP…"
                  : allReady
                    ? "Скачать всё ZIP"
                    : `Готовим ${readyItems.length} из ${validItems.length}`
                : activeExporting
                  ? "Готовим WebP…"
                  : "Скачать WebP"}
              <span aria-hidden="true">↓</span>
            </button>
          </aside>
        </div>
      </section>

      <footer>
        <span>Локальная обработка</span>
        <span>Без регистрации</span>
        <span>До 30 изображений</span>
      </footer>
    </main>
  );
}
