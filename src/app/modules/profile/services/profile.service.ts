import { Injectable, inject } from '@angular/core';
import { UserProfile } from '../models/profile.model';
import { BehaviorSubject, Observable, of, defer, EMPTY } from 'rxjs';
import { ApiService } from 'src/app/core/services/api.service';
import { catchError, map, tap, shareReplay, takeUntil } from 'rxjs/operators';
import { TokenService } from 'src/app/modules/auth/services/token.service';
import { StorageService } from 'src/app/modules/auth/services/storage.service';
import { toObservable } from '@angular/core/rxjs-interop';

// Deprecated old storage key - kept for cleanup only
const LEGACY_STORAGE_KEY = 'ew_user_profile_v1';
const PROFILE_CACHE_KEY = 'profile';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly profileSubject = new BehaviorSubject<UserProfile | null>(
    null
  );

  public readonly profile$ = this.profileSubject.asObservable();

  private readonly PROFILE_ME_ENDPOINT = '/user/me';
  private readonly PROFILE_AVATAR_ENDPOINT = '/user/me/avatar';

  // Use app-wide storage (prefix madarflow_) so the key becomes 'madarflow_user'
  private storage = inject(StorageService);
  private api = inject(ApiService);
  private tokens = inject(TokenService);
  private profileOwnerId: string | null = null;

  constructor() {
    // Initialize stream with current value from storage
    // Cleanup legacy key if exists (do not rely on it anymore)
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {}
    const storedProfile = this.storage.get<any>(PROFILE_CACHE_KEY);
    const storedUser = this.storage.get<any>('user');
    this.profileOwnerId =
      storedProfile?.ownerId ||
      (storedUser?._id ? String(storedUser._id) : null);
    const existing = this.getProfile();
    this.profileSubject.next(existing);
    toObservable(this.tokens.user).subscribe((user) => {
      if (!user) return;
      const ownerId = user._id ? String(user._id) : null;
      const sameOwner = !!ownerId && ownerId === this.profileOwnerId;
      if (ownerId && this.profileOwnerId && !sameOwner)
        this.profileSubject.next(null);
      // Storage may already have been overwritten by TokenService with the
      // incomplete auth user. The subject is the last canonical profile.
      const current = sameOwner ? this.profileSubject.value : null;
      const normalized = this.normalizeProfile({
        ...user,
        ...(current ?? {}),
        avatarUrl: sameOwner ? current?.avatarUrl : user.image || undefined,
      });
      if (normalized) {
        this.profileOwnerId = ownerId;
        this.saveProfile(normalized);
      }
    });
  }

  /**
   * Clear locally cached profile completely.
   * Removes the storage entry and resets the observable stream to null.
   */
  clearProfile(): void {
    try {
      this.storage.remove('user');
      this.storage.remove(PROFILE_CACHE_KEY);
      // Cleanup legacy key as well just in case
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {}
    } catch (e) {
      console.error('Failed to clear profile from storage', e);
    }
    this.profileSubject.next(null);
    this.profileOwnerId = null;
  }

  private normalizeProfile(raw: any | null): UserProfile | null {
    if (!raw) return null;
    // Some APIs return { data: user, message }, others return user directly
    const data = raw && raw.data ? raw.data : raw;
    if (!data) return null;
    // Normalize salary into array of {label, amount}
    const rawSalary = data.salary;
    let salaryArr: { label: string; amount: number }[] = [];
    if (Array.isArray(rawSalary)) {
      salaryArr = rawSalary
        .filter((s: any) => s && typeof s.amount === 'number' && s.amount >= 0)
        .map((s: any) => ({
          label: String(s.label ?? 'Salary'),
          amount: Number(s.amount),
        }));
    } else if (typeof rawSalary === 'number') {
      salaryArr = [{ label: 'Salary', amount: rawSalary }];
    }

    // Map backend fields to UserProfile
    const profile: UserProfile = {
      username: (data.username ?? data.fullName ?? '').toString(),
      email: data.email ?? '',
      phone: data.phone ?? '',
      salary: salaryArr,
      currency: data.currency ?? '', // no silent default: the user picks one (D-024)
      avatarUrl: data.avatarUrl ?? data.image ?? undefined,
      createdAt: data.createdAt ?? data.created_at ?? undefined,
    } as UserProfile;
    return profile;
  }

  getProfile(): UserProfile | null {
    try {
      // Read unified user object stored under key 'madarflow_user'
      const cached = this.storage.get<any>(PROFILE_CACHE_KEY);
      const raw = cached?.profile ?? cached ?? this.storage.get<any>('user');
      // raw might already be a normalized UserProfile or a backend User; normalize either
      return this.normalizeProfile(raw);
    } catch (e) {
      console.error('Failed to read profile from storage', e);
      return null;
    }
  }

  saveProfile(profile: UserProfile): boolean {
    try {
      // Persist using shared storage => key becomes 'madarflow_user'
      this.storage.set(PROFILE_CACHE_KEY, {
        ownerId: this.profileOwnerId || this.tokens.getUserId(),
        profile,
      });
      this.profileSubject.next(profile);
      return true;
    } catch (e) {
      console.error('Failed to save profile', e);
      return false;
    }
  }

  saveProfilePart(partial: Partial<UserProfile>): boolean {
    const current = this.getProfile() ?? {
      username: '',
      email: '',
      phone: '',
      salary: [],
      currency: '',
    };
    const merged: UserProfile = { ...current, ...partial } as UserProfile;
    return this.saveProfile(merged);
  }

  /**
   * Fetch profile from backend and propagate to local cache and stream.
   * Uses shareReplay to cache the result and share it among multiple subscribers.
   */
  fetchProfile(): Observable<UserProfile | null> {
    return defer(() => {
      // Observable auth consumers update after synchronous profile-clear emissions.
      if (!this.tokens.getAccessToken() || !this.tokens.getUser()) return EMPTY;
      return this.api.get<any>(this.PROFILE_ME_ENDPOINT);
    }).pipe(
      takeUntil(this.tokens.sessionEnded$),
      map((res) => this.normalizeProfile(res)),
      tap((profile) => {
        if (profile) this.saveProfile(profile);
      }),
      catchError((err) => {
        console.error('Failed to fetch profile', err);
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  hydrateForSession(): void {
    if (this.tokens.getAccessToken()) {
      this.fetchProfile().subscribe({
        error: () => undefined,
      });
    }
  }

  /**
   * Update profile on backend; accepts partial but backend may require full document.
   * We optimistically merge with current profile before sending.
   */
  updateProfile(partial: Partial<UserProfile>): Observable<UserProfile | null> {
    const current = this.getProfile();
    const previous = current
      ? ({
          ...current,
          salary: Array.isArray(current.salary)
            ? current.salary.map((detail) => ({ ...detail }))
            : [],
        } as UserProfile)
      : null;
    // Ensure salary is in array shape when sending
    let merged: any = { ...(current ?? {}), ...partial } as UserProfile & any;
    if (merged.salary !== undefined) {
      const ms = merged.salary;
      if (Array.isArray(ms)) {
        merged.salary = ms.map((s) => ({
          label: String(s.label ?? 'Salary'),
          amount: Number(s.amount ?? 0),
        }));
      } else if (typeof ms === 'number') {
        merged.salary = [{ label: 'Salary', amount: ms }];
      } else {
        merged.salary = [];
      }
    }
    const body = merged as UserProfile;

    // Optimistic update: immediately reflect changes in local cache/stream
    this.saveProfile(body);

    return this.api.put<any>(this.PROFILE_ME_ENDPOINT, body).pipe(
      map((res) => this.normalizeProfile(res)),
      tap((updated) => {
        if (updated) {
          // Preserve fields we sent (salary/currency) in case backend echoes stale values
          const finalProfile: UserProfile = {
            ...updated,
            salary: (body as any).salary ?? updated.salary,
            currency: (body as any).currency ?? updated.currency,
          } as UserProfile;
          this.saveProfile(finalProfile);
        }
      }),
      catchError((err) => {
        console.error('Failed to update profile', err);
        if (previous) this.saveProfile(previous);
        return of(null);
      })
    );
  }

  /**
   * Upload avatar image to backend.
   * Tries to extract avatarUrl from different common response shapes.
   */
  uploadAvatar(file: File): Observable<UserProfile | null> {
    const fd = new FormData();
    fd.append('avatar', file);

    return this.api.postFormData<any>(this.PROFILE_AVATAR_ENDPOINT, fd).pipe(
      map((res) => {
        // Prefer avatarUrl if provided at top-level or under data
        const avatarUrl =
          res?.avatarUrl || res?.data?.avatarUrl || res?.result?.avatarUrl;
        if (avatarUrl) {
          const merged = {
            ...(this.getProfile() ?? {}),
            avatarUrl,
          } as UserProfile;
          this.saveProfile(merged);
          return merged;
        }
        // Otherwise normalize user payload possibly under data or user
        const userPayload = res?.user ?? res?.data ?? res;
        const normalized = this.normalizeProfile(userPayload);
        if (normalized) {
          this.saveProfile(normalized);
          return normalized;
        }
        return null;
      }),
      catchError((err) => {
        console.error('Failed to upload avatar', err);
        return of(null);
      })
    );
  }

  /** Clear the persisted avatar using the existing profile update contract. */
  removeAvatar(): Observable<UserProfile | null> {
    return this.api.put<any>(this.PROFILE_ME_ENDPOINT, { image: null }).pipe(
      map((res) => this.normalizeProfile(res)),
      tap((updated) => {
        const cleared: UserProfile = {
          ...(this.getProfile() ?? {}),
          ...(updated ?? {}),
          avatarUrl: undefined,
        } as UserProfile;
        this.saveProfile(cleared);
      }),
      catchError((err) => {
        console.error('Failed to remove avatar', err);
        return of(null);
      })
    );
  }
}
