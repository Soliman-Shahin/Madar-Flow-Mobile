import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';
import { StorageService } from 'src/app/modules/auth/services/storage.service';

/**
 * Dashboard-managed content (support contacts, legal documents, FAQ,
 * maintenance notice, version policy).
 *
 * A section that is not configured is simply absent and the app keeps its
 * built-in content for it. The last successful response is cached so the app
 * works offline; everything read from the network or the cache is re-validated
 * here before the UI sees it (https-only links, bounded text).
 */

export interface LocalizedText {
  ar?: string;
  en?: string;
}

export interface LegalDocument {
  version: string;
  updatedAt?: string;
  title?: LocalizedText;
  body: LocalizedText;
}

export interface PublicAppSettings {
  revision: number;
  support?: {
    email?: string;
    /** Digits only, international format (for https://wa.me/<digits>). */
    whatsapp?: string;
    website?: string;
    hours?: LocalizedText;
    links?: { label: LocalizedText; url: string }[];
  };
  legal?: { terms?: LegalDocument; privacy?: LegalDocument };
  faq?: { question: LocalizedText; answer: LocalizedText }[];
  maintenance?: { enabled: boolean; message?: LocalizedText };
  versioning?: { minVersion?: string; latestVersion?: string; storeUrl?: string };
}

const MAX_SHORT = 300;
const MAX_LONG = 60_000;

const asObject = (value: unknown): Record<string, any> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() && value.length <= max * 2
    ? value.trim().slice(0, max)
    : undefined;

export function localized(value: unknown, max = MAX_SHORT): LocalizedText | undefined {
  const source = asObject(value);
  if (!source) return undefined;
  const out: LocalizedText = {};
  const ar = text(source['ar'], max);
  const en = text(source['en'], max);
  if (ar) out.ar = ar;
  if (en) out.en = en;
  return out.ar || out.en ? out : undefined;
}

export function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

const email = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? value.trim()
    : undefined;

const whatsapp = (value: unknown): string | undefined =>
  typeof value === 'string' && /^\d{8,15}$/.test(value.trim()) ? value.trim() : undefined;

const semver = (value: unknown): string | undefined =>
  typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value.trim())
    ? value.trim()
    : undefined;

function legalDocument(value: unknown): LegalDocument | undefined {
  const source = asObject(value);
  const version = text(source?.['version'], 32);
  const body = localized(source?.['body'], MAX_LONG);
  if (!source || !version || !body) return undefined;
  return {
    version,
    updatedAt: typeof source['updatedAt'] === 'string' ? source['updatedAt'] : undefined,
    title: localized(source['title'], 120),
    body,
  };
}

/** Validate untrusted data (network or cache) into the shape the UI uses. */
export function sanitizeAppSettings(raw: unknown): PublicAppSettings | null {
  const source = asObject(raw);
  if (!source) return null;
  const out: PublicAppSettings = {
    revision: Number.isInteger(source['revision']) ? source['revision'] : 0,
  };

  const s = asObject(source['support']);
  if (s) {
    const links = (Array.isArray(s['links']) ? s['links'] : [])
      .slice(0, 8)
      .map((l: unknown) => {
        const link = asObject(l);
        const url = httpsUrl(link?.['url']);
        return url ? { label: localized(link?.['label'], 60) ?? {}, url } : null;
      })
      .filter((l: unknown): l is { label: LocalizedText; url: string } => !!l);
    const support = {
      email: email(s['email']),
      whatsapp: whatsapp(s['whatsapp']),
      website: httpsUrl(s['website']),
      hours: localized(s['hours'], 200),
      links: links.length ? links : undefined,
    };
    if (Object.values(support).some((v) => v !== undefined)) out.support = support;
  }

  const l = asObject(source['legal']);
  if (l) {
    const terms = legalDocument(l['terms']);
    const privacy = legalDocument(l['privacy']);
    if (terms || privacy) out.legal = { terms, privacy };
  }

  if (Array.isArray(source['faq'])) {
    const faq = source['faq']
      .slice(0, 40)
      .map((item: unknown) => {
        const f = asObject(item);
        const question = localized(f?.['question'], 300);
        return question
          ? { question, answer: localized(f?.['answer'], 3000) ?? {} }
          : null;
      })
      .filter((f: unknown): f is { question: LocalizedText; answer: LocalizedText } => !!f);
    if (faq.length) out.faq = faq;
  }

  const m = asObject(source['maintenance']);
  if (m && typeof m['enabled'] === 'boolean') {
    out.maintenance = { enabled: m['enabled'], message: localized(m['message'], 500) };
  }

  const v = asObject(source['versioning']);
  if (v) {
    const versioning = {
      minVersion: semver(v['minVersion']),
      latestVersion: semver(v['latestVersion']),
      storeUrl: httpsUrl(v['storeUrl']),
    };
    if (Object.values(versioning).some((x) => x !== undefined)) out.versioning = versioning;
  }
  return out;
}

/** Pick the text for `lang`, falling back to the other language. */
export function pickLocalized(value: LocalizedText | undefined, lang: string): string | undefined {
  if (!value) return undefined;
  const order: (keyof LocalizedText)[] = lang === 'ar' ? ['ar', 'en'] : ['en', 'ar'];
  for (const key of order) if (value[key]) return value[key];
  return undefined;
}

export interface LegalSection {
  title?: string;
  paragraphs: string[];
}

/**
 * Turn dashboard legal text into sections. Plain text only: a line starting
 * with "# " is a heading; blank lines separate paragraphs.
 */
export function parseLegalText(body: string): LegalSection[] {
  const sections: LegalSection[] = [];
  for (const block of body.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('# ')) {
      const [first, ...rest] = trimmed.split('\n');
      const section: LegalSection = { title: first.slice(2).trim(), paragraphs: [] };
      const remainder = rest.join('\n').trim();
      if (remainder) section.paragraphs.push(remainder);
      sections.push(section);
    } else {
      if (!sections.length) sections.push({ paragraphs: [] });
      sections[sections.length - 1].paragraphs.push(trimmed);
    }
  }
  return sections;
}

/** True when `a` is lower than `b` (MAJOR.MINOR.PATCH). */
export function isOlderVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(StorageService);
  private readonly apiUrl = Capacitor.isNativePlatform()
    ? environment.nativeApiUrl
    : environment.browserApiUrl;
  private static readonly CACHE_KEY = 'app_settings_v1';
  private static readonly MIN_INTERVAL_MS = 60_000;

  private readonly state = signal<PublicAppSettings | null>(
    sanitizeAppSettings(this.storage.get(AppSettingsService.CACHE_KEY))
  );
  private lastAttempt = 0;
  private inFlight: Promise<void> | null = null;

  /** Last known dashboard content (null until the first successful fetch). */
  readonly settings = this.state.asReadonly();
  readonly support = computed(() => this.state()?.support);
  readonly faq = computed(() => this.state()?.faq);
  readonly legal = computed(() => this.state()?.legal);
  readonly maintenance = computed(() => this.state()?.maintenance);
  readonly versioning = computed(() => this.state()?.versioning);

  /**
   * Fetch the latest content. Never throws: on failure the cached content (or
   * the built-in defaults) stays in place. Calls are throttled to once a minute.
   */
  refresh(force = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!force && Date.now() - this.lastAttempt < AppSettingsService.MIN_INTERVAL_MS) {
      return Promise.resolve();
    }
    this.lastAttempt = Date.now();
    this.inFlight = firstValueFrom(
      this.http.get<{ data?: unknown }>(`${this.apiUrl}/app-settings`)
    )
      .then((response) => {
        const next = sanitizeAppSettings(response?.data);
        if (!next) return;
        this.state.set(next);
        this.storage.set(AppSettingsService.CACHE_KEY, next);
      })
      .catch(() => {
        /* offline or server unavailable: keep what we have */
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
