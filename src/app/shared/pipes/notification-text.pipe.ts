import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

interface NotificationLike {
  title: string;
  message: string;
  event?: string;
  metadata?: Record<string, unknown>;
}

/** Events whose text the app writes itself, so it follows the app language. */
const KEYS: Record<string, string> = {
  'security.new_login': 'NOTIFICATION_TEXT.NEW_LOGIN',
  'security.session_limit': 'NOTIFICATION_TEXT.SESSION_LIMIT',
};

/**
 * The server sends English text. For events the app knows, show the
 * translated version (filled from the event's metadata); anything else is
 * shown exactly as the server wrote it (e.g. an admin broadcast).
 */
@Pipe({ name: 'notificationText', standalone: true, pure: false })
export class NotificationTextPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(item: NotificationLike, part: 'title' | 'message'): string {
    const base = item.event ? KEYS[item.event] : undefined;
    if (!base) return item[part];
    const key = `${base}_${part.toUpperCase()}`;
    const meta = item.metadata ?? {};
    const devices = Array.isArray(meta['endedDevices'])
      ? (meta['endedDevices'] as unknown[]).map(String).join(this.translate.currentLang === 'ar' ? '، ' : ', ')
      : '';
    const text = this.translate.instant(key, {
      devices,
      max: meta['maxDevices'] ?? '',
    });
    // instant() returns the key itself when it is missing: keep the server text then.
    return text === key ? item[part] : text;
  }
}
