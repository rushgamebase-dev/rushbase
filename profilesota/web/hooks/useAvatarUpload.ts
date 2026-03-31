'use client';

import { useState, useCallback } from 'react';

/**
 * Avatar upload hook.
 *
 * Strategy: converts the selected file to a data URL for immediate preview,
 * then (when a presigned URL endpoint is available) uploads to S3/CDN.
 *
 * For now, returns a base64 data URL that can be stored directly or used
 * as a preview until a real upload endpoint is wired.
 */
export function useAvatarUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const upload = useCallback(async (file: File): Promise<string> => {
    setIsUploading(true);
    setProgress(0);

    try {
      // Validate
      if (!file.type.startsWith('image/')) {
        throw new Error('File must be an image');
      }
      if (file.size > 2 * 1024 * 1024) {
        throw new Error('File must be under 2MB');
      }

      setProgress(20);

      // Resize to max 256x256
      const resized = await resizeImage(file, 256);
      setProgress(60);

      // TODO: When upload endpoint is ready, replace this with:
      // 1. GET /api/upload/presigned-url → { url, key }
      // 2. PUT file to presigned URL
      // 3. Return CDN URL
      //
      // For now, return as data URL (works for dev/preview):
      setProgress(100);
      return resized;
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { upload, isUploading, progress };
}

function resizeImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      let { width, height } = img;

      if (width > height) {
        if (width > maxSize) {
          height = Math.round(height * (maxSize / width));
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = Math.round(width * (maxSize / height));
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/webp', 0.85));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}
