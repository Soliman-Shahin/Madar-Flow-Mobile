import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/**
 * Hands a generated file to the user.
 * - Browser/PWA: a normal download.
 * - Android/iOS: written to the app cache and opened in the system share sheet
 *   (a WebView cannot download a Blob).
 */
@Injectable({ providedIn: 'root' })
export class FileShareService {
  async deliver(
    fileName: string,
    mimeType: string,
    content: string | Uint8Array,
    shareTitle: string
  ): Promise<ExportOutcome> {
    const bytes =
      typeof content === 'string' ? new TextEncoder().encode(content) : content;

    if (!Capacitor.isNativePlatform()) {
      this.download(fileName, mimeType, bytes);
      return 'downloaded';
    }

    await this.clearPreviousExports();
    const written = await Filesystem.writeFile({
      path: fileName,
      data: toBase64(bytes),
      directory: Directory.Cache,
    });
    try {
      await Share.share({
        title: shareTitle,
        dialogTitle: shareTitle,
        url: written.uri,
      });
      return 'shared';
    } catch (error) {
      // Dismissing the share sheet rejects on some platforms; that is not a failure.
      const message = String((error as Error)?.message ?? error).toLowerCase();
      if (message.includes('cancel') || message.includes('dismiss')) {
        return 'cancelled';
      }
      throw error;
    }
  }

  private download(
    fileName: string,
    mimeType: string,
    bytes: Uint8Array
  ): void {
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Exports contain financial data; do not let old ones pile up in the cache. */
  private async clearPreviousExports(): Promise<void> {
    try {
      const { files } = await Filesystem.readdir({
        path: '',
        directory: Directory.Cache,
      });
      await Promise.all(
        files
          .filter((f) => /^madar-flow-.*\.(csv|pdf)$/.test(f.name))
          .map((f) =>
            Filesystem.deleteFile({ path: f.name, directory: Directory.Cache })
          )
      );
    } catch {
      /* best effort */
    }
  }
}
