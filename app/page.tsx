"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Cropper, { type Area, type Point, type Size } from "react-easy-crop";
import ReactCrop, {
  type PercentCrop,
  type PixelCrop,
} from "react-image-crop";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const OUTPUT_SIZES = [256, 512, 1024, 2048];
const DEFAULT_FREE_CROP: PercentCrop = {
  unit: "%",
  x: 10,
  y: 10,
  width: 80,
  height: 80,
};
type CropMode = "none" | "square" | "round" | "free";

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

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [imageSrc, setImageSrc] = useState("");
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [freeCrop, setFreeCrop] =
    useState<PercentCrop>(DEFAULT_FREE_CROP);
  const [cropMode, setCropMode] = useState<CropMode>("none");
  const [quality, setQuality] = useState(82);
  const [outputSize, setOutputSize] = useState(1024);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputUrl, setOutputUrl] = useState("");
  const [cropSize, setCropSize] = useState<Size | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const sourceUrlRef = useRef("");
  const outputUrlRef = useRef("");
  const freeImageRef = useRef<HTMLImageElement>(null);

  const releaseUrls = useCallback(() => {
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    sourceUrlRef.current = "";
    outputUrlRef.current = "";
  }, []);

  useEffect(() => releaseUrls, [releaseUrls]);

  const resetFrame = useCallback(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setFreeCrop(DEFAULT_FREE_CROP);
  }, []);

  const openFile = useCallback(
    async (nextFile?: File) => {
      if (!nextFile) return;
      setError("");

      if (nextFile.size > MAX_FILE_SIZE) {
        setError("Файл больше 50 МБ. Выберите изображение поменьше.");
        return;
      }

      const extension = nextFile.name.split(".").pop()?.toLowerCase();
      const supported =
        nextFile.type.startsWith("image/") ||
        extension === "heic" ||
        extension === "heif";

      if (!supported) {
        setError("Поддерживаются JPG, PNG, WebP, HEIC и HEIF.");
        return;
      }

      setBusy(true);
      setOutputBlob(null);
      setOutputUrl("");
      setCroppedArea(null);

      try {
        let preview: Blob = nextFile;
        const isHeic =
          extension === "heic" ||
          extension === "heif" ||
          /hei[cf]/i.test(nextFile.type);

        if (isHeic) {
          const { heicTo } = await import("heic-to");
          preview = await heicTo({
            blob: nextFile,
            type: "image/jpeg",
            quality: 0.95,
          });
        }

        const nextUrl = URL.createObjectURL(preview);
        await loadImage(nextUrl);
        releaseUrls();
        sourceUrlRef.current = nextUrl;
        setImageSrc(nextUrl);
        setFile(nextFile);
        resetFrame();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Не удалось обработать изображение",
        );
      } finally {
        setBusy(false);
      }
    },
    [releaseUrls, resetFrame],
  );

  const onCropComplete = useCallback(
    (_: Area, areaPixels: Area) => {
      setExporting(true);
      setCroppedArea(areaPixels);
    },
    [],
  );

  const onFreeCropComplete = useCallback((nextCrop: PixelCrop) => {
    const image = freeImageRef.current;
    if (!image || !nextCrop.width || !nextCrop.height) return;

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    setExporting(true);
    setCroppedArea({
      x: Math.round(nextCrop.x * scaleX),
      y: Math.round(nextCrop.y * scaleY),
      width: Math.round(nextCrop.width * scaleX),
      height: Math.round(nextCrop.height * scaleY),
    });
  }, []);

  const initializeFreeCrop = useCallback(
    (image: HTMLImageElement, nextCrop = freeCrop) => {
      setExporting(true);
      setCroppedArea({
        x: Math.round((image.naturalWidth * nextCrop.x) / 100),
        y: Math.round((image.naturalHeight * nextCrop.y) / 100),
        width: Math.round((image.naturalWidth * nextCrop.width) / 100),
        height: Math.round((image.naturalHeight * nextCrop.height) / 100),
      });
    },
    [freeCrop],
  );

  const resetFreeFrame = useCallback(() => {
    setFreeCrop(DEFAULT_FREE_CROP);
    if (freeImageRef.current) {
      initializeFreeCrop(freeImageRef.current, DEFAULT_FREE_CROP);
    }
  }, [initializeFreeCrop]);

  useEffect(() => {
    if (!imageSrc || (cropMode !== "none" && !croppedArea)) return;

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const blob = await renderWebp(
          imageSrc,
          croppedArea,
          outputSize,
          quality / 100,
          cropMode,
        );
        if (cancelled) return;

        const nextUrl = URL.createObjectURL(blob);
        if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
        outputUrlRef.current = nextUrl;
        setOutputUrl(nextUrl);
        setOutputBlob(blob);
        setError("");
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Не удалось создать WebP",
          );
        }
      } finally {
        if (!cancelled) setExporting(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [cropMode, croppedArea, imageSrc, outputSize, quality]);

  const download = useCallback(() => {
    if (!file || !outputBlob || !outputUrl) return;
    const link = document.createElement("a");
    link.href = outputUrl;
    link.download = outputName(file.name, cropMode);
    link.click();
  }, [cropMode, file, outputBlob, outputUrl]);

  const clear = useCallback(() => {
    releaseUrls();
    setFile(null);
    setImageSrc("");
    setOutputBlob(null);
    setOutputUrl("");
    setError("");
    setBusy(false);
    setExporting(false);
  }, [releaseUrls]);

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Быстрый WebP — на главную">
          <span className="brand-mark" aria-hidden="true" />
          Быстрый WebP
        </Link>
        <span className="privacy">
          <span aria-hidden="true">●</span> Фото остаётся в браузере
        </span>
      </header>

      <section className="workspace">
        <div className="workspace-title">
          <div>
            <p className="eyebrow">Конвертация в браузере</p>
            <h1>Подготовьте WebP</h1>
          </div>
          {imageSrc && (
            <button className="text-button" type="button" onClick={clear}>
              Другое фото
            </button>
          )}
        </div>

        <div className="editor-grid">
          {!imageSrc ? (
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
                void openFile(event.dataTransfer.files[0]);
              }}
            >
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(event) => void openFile(event.target.files?.[0])}
              />
              <span className="upload-icon" aria-hidden="true">
                +
              </span>
              <strong>
                {busy ? "Читаем фотографию…" : "Выбрать фотографию"}
              </strong>
              <span>или перетащите её сюда</span>
              <small>JPG, PNG, WebP, HEIC · до 50 МБ</small>
            </label>
          ) : (
            <div className="editor-card">
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
                        showOriginal || exporting || !outputUrl
                          ? imageSrc
                          : outputUrl
                      }
                      alt="Предпросмотр изображения целиком"
                    />
                    {outputUrl && !showOriginal && !exporting && (
                      <span>WebP · {quality}%</span>
                    )}
                  </div>
                ) : cropMode === "free" ? (
                  <div className="free-crop-preview">
                    <ReactCrop
                      crop={freeCrop}
                      keepSelection
                      minWidth={40}
                      minHeight={40}
                      onChange={(_, percentCrop) => setFreeCrop(percentCrop)}
                      onComplete={onFreeCropComplete}
                      onDragStart={() => setInteracting(true)}
                      onDragEnd={() => setInteracting(false)}
                      renderSelectionAddon={() =>
                        outputUrl ? (
                          <div
                            className={`free-webp-overlay ${
                              interacting || showOriginal || exporting
                                ? "is-hidden"
                                : ""
                            }`}
                            aria-hidden="true"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={outputUrl} alt="" />
                            <span>WebP · {quality}%</span>
                          </div>
                        ) : null
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        ref={freeImageRef}
                        src={imageSrc}
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
                      key={cropMode}
                      image={imageSrc}
                      crop={crop}
                      zoom={zoom}
                      aspect={1}
                      cropShape={cropMode === "round" ? "round" : "rect"}
                      showGrid={false}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onCropComplete={onCropComplete}
                      onCropSizeChange={setCropSize}
                      onInteractionStart={() => setInteracting(true)}
                      onInteractionEnd={() => setInteracting(false)}
                    />
                    {outputUrl && cropSize && (
                      <div
                        className={`webp-overlay ${
                          cropMode === "round" ? "is-round" : ""
                        } ${
                          interacting || showOriginal || exporting
                            ? "is-hidden"
                            : ""
                        }`}
                        style={{ width: cropSize.width, height: cropSize.height }}
                        aria-hidden="true"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={outputUrl} alt="" />
                        <span>WebP · {quality}%</span>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="editor-hint">
                <span>
                  {exporting
                    ? "Обновляем WebP…"
                    : cropMode === "free"
                      ? outputUrl
                        ? "Готовый WebP показан внутри рамки"
                        : "Тяните углы или стороны рамки"
                    : outputUrl
                      ? "Показан готовый WebP"
                      : cropMode === "none"
                        ? "Изображение будет экспортировано целиком"
                        : `Перетаскивайте фото внутри ${
                            cropMode === "round" ? "круга" : "квадрата"
                          }`}
                </span>
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
                    <button
                      type="button"
                      onClick={
                        cropMode === "free" ? resetFreeFrame : resetFrame
                      }
                    >
                      По центру
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <aside className="controls-card">
              <div className="file-row">
                <div>
                  <span>Исходник</span>
                  <strong title={file?.name}>
                    {file?.name ?? "Файл не выбран"}
                  </strong>
                </div>
                <b>{file ? formatBytes(file.size) : "—"}</b>
              </div>

              <div className="mode-control">
                <span>Форма</span>
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
                      onClick={() => {
                        if (imageSrc) setExporting(true);
                        setCroppedArea(null);
                        setCropMode(mode);
                        resetFrame();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {cropMode !== "none" && cropMode !== "free" && (
                <label className="control">
                  <span>
                    Масштаб <b>{zoom.toFixed(1)}×</b>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.05"
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
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
                  value={quality}
                  onChange={(event) => {
                    if (imageSrc) setExporting(true);
                    setQuality(Number(event.target.value));
                  }}
                />
              </label>

              <label className="control">
                <span>
                  {cropMode === "none" ? "Максимальная сторона" : "Размер"}
                </span>
                <select
                  value={outputSize}
                  onChange={(event) => {
                    if (imageSrc) setExporting(true);
                    setOutputSize(Number(event.target.value));
                  }}
                >
                  {OUTPUT_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {cropMode === "none"
                        ? `${size} px`
                        : `${getOutputSize(size, cropMode, croppedArea).width} × ${
                            getOutputSize(size, cropMode, croppedArea).height
                          } px`}
                    </option>
                  ))}
                </select>
              </label>

              <div className="result">
                <div>
                  <span>Готовый WebP</span>
                  <strong>
                    {!file
                      ? "—"
                      : exporting || !outputBlob
                      ? "Считаем…"
                      : formatBytes(outputBlob.size)}
                  </strong>
                  {file && outputBlob && (
                    <small>
                      {outputBlob.size < file.size
                        ? `На ${Math.round((1 - outputBlob.size / file.size) * 100)}% легче`
                        : "Размер вырос из-за выбранных настроек"}
                    </small>
                  )}
                </div>
              </div>

              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}

              <button
                className="download"
                type="button"
                disabled={!outputBlob || exporting}
                onClick={download}
              >
                {exporting ? "Готовим WebP…" : "Скачать WebP"}
                <span aria-hidden="true">↓</span>
              </button>
          </aside>
        </div>
      </section>

      <footer>
        <span>Локальная обработка</span>
        <span>Без регистрации</span>
        <span>Без обрезки · квадрат · круг · свободная</span>
      </footer>
    </main>
  );
}
