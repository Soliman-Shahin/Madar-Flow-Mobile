import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  inject,
} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  Validators,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { ToastService } from 'src/app/shared/services/toast.service';
import { BaseComponent } from 'src/app/shared/base/base.component';
import { ProfileService } from '../../services/profile.service';
import { SUPPORTED_CURRENCIES } from 'src/app/shared/utils';
import { UserProfile } from '../../models/profile.model';
import { BehaviorSubject, combineLatest, takeUntil } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';
import {
  ActionSheetController,
  ItemReorderEventDetail,
  IonicModule,
} from '@ionic/angular';
import { UiInputComponent } from '../../../../shared/ui/ui-input/ui-input.component';
import { AsyncPipe, DecimalPipe } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SkeletonBlockComponent } from '../../../../shared/ui/skeleton-block/skeleton-block.component';
import { AlertService } from 'src/app/shared/services/alert.service';

interface ProfileAuthMetadata {
  providerLabelKey: string | null;
  statusLabelKey: string | null;
}

@Component({
  selector: 'app-profile-page',
  templateUrl: './profile-page.component.html',
  styleUrls: ['./profile-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    IonicModule,
    FormsModule,
    ReactiveFormsModule,
    UiInputComponent,
    AsyncPipe,
    DecimalPipe,
    TranslateModule,
    SkeletonBlockComponent,
  ],
})
export class ProfilePageComponent extends BaseComponent implements OnInit {
  personalForm!: FormGroup;
  salaryForm!: FormGroup;
  @ViewChild('avatarInput') avatarInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('cropCanvas') cropCanvasRef?: ElementRef<HTMLCanvasElement>;
  avatarUrl: string | null = null;
  isPersonalFormDirty = false;
  isSalaryFormDirty = false;

  // State
  private isLoadingProfile$ = new BehaviorSubject<boolean>(false);
  private isLoadingPersonal$ = new BehaviorSubject<boolean>(false);
  private isLoadingSalary$ = new BehaviorSubject<boolean>(false);
  private isLoadingAvatar$ = new BehaviorSubject<boolean>(false);
  private isPreparingAvatar$ = new BehaviorSubject<boolean>(false);
  private errorMessage$ = new BehaviorSubject<string | null>(null);

  private readonly profileService = inject(ProfileService);
  private readonly translate = inject(TranslateService);
  private readonly actionSheetController = inject(ActionSheetController);
  cropEditorOpen = false;
  cropZoom = 1;
  private cropSourceUrl: string | null = null;
  private cropImage: HTMLImageElement | null = null;
  private cropBaseScale = 1;
  private cropPanX = 0;
  private cropPanY = 0;
  private cropDrag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        panX: number;
        panY: number;
      }
    | undefined;
  private pendingAvatarFile: File | null = null;
  private readonly cropViewportSize = 280;
  private readonly avatarMaxSourceBytes = 5 * 1024 * 1024;
  private readonly avatarOutputSize = 512;

  readonly authMetadata$ = this.authService.user$.pipe(
    map((user): ProfileAuthMetadata => {
      const providerLabelKey =
        user?.signupType === 'google'
          ? 'PROFILE.AUTH.PROVIDER_GOOGLE'
          : user?.signupType === 'facebook'
          ? 'PROFILE.AUTH.PROVIDER_FACEBOOK'
          : user?.signupType === 'normal'
          ? 'PROFILE.AUTH.PROVIDER_EMAIL'
          : null;
      const statusLabelKey =
        typeof user?.emailVerified === 'boolean'
          ? user.emailVerified
            ? 'PROFILE.AUTH.STATUS_VERIFIED'
            : 'PROFILE.AUTH.STATUS_UNVERIFIED'
          : null;
      return { providerLabelKey, statusLabelKey };
    })
  );

  vm$ = combineLatest({
    profile: this.profileService.profile$,
    isLoadingProfile: this.isLoadingProfile$.asObservable(),
    isLoadingPersonal: this.isLoadingPersonal$.asObservable(),
    isLoadingSalary: this.isLoadingSalary$.asObservable(),
    isLoadingAvatar: this.isLoadingAvatar$.asObservable(),
    isPreparingAvatar: this.isPreparingAvatar$.asObservable(),
    errorMessage: this.errorMessage$.asObservable(),
    authMetadata: this.authMetadata$,
  });

  currencies: string[] = [...SUPPORTED_CURRENCIES];
  private nextDetailId = 0;
  private leaveConfirmationOpen = false;

  override ngOnInit(): void {
    super.ngOnInit();
    this.personalForm = this.fb.group({
      username: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(50),
        ],
      ],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.maxLength(20)]],
    });

    this.salaryForm = this.fb.group({
      details: this.fb.array([], this.duplicateLabelsValidator.bind(this)),
      currency: ['', [Validators.required]],
    });

    const existing = this.profileService.getProfile();
    if (existing) {
      this.patchFromProfile(existing);
    }

    this.loadProfile();

    // Subscribe to changes for reactive UI (e.g., avatar preview updates)
    this.profileService.profile$
      .pipe(takeUntil(this.destroy$))
      .subscribe((profile) => {
        if (!profile) {
          this.avatarUrl = null;
          this.personalForm.reset({}, { emitEvent: false });
          while (this.details.length) this.details.removeAt(0);
          this.details.push(this.createDetailGroup('Salary', 0));
          this.salaryForm.patchValue({ currency: '' }, { emitEvent: false });
          this.personalForm.markAsPristine();
          this.salaryForm.markAsPristine();
          this.isPersonalFormDirty = false;
          this.isSalaryFormDirty = false;
          return;
        }
        // Do not overwrite user's edits while forms are dirty
        const isEditing = this.personalForm.dirty || this.salaryForm.dirty;
        if (isEditing) return;
        this.patchFromProfile(profile);
      });

    this.personalForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => (this.isPersonalFormDirty = true));

    this.salaryForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => (this.isSalaryFormDirty = true));

    this.personalForm.get('email')?.disable();
  }

  loadProfile(): void {
    this.isLoadingProfile$.next(true);
    this.setLoading(true);
    this.errorMessage$.next(null);
    this.profileService
      .fetchProfile()
      .pipe(
        finalize(() => {
          this.isLoadingProfile$.next(false);
          this.setLoading(false);
        }),
        takeUntil(this.destroy$),
        catchError(() => {
          this.errorMessage$.next('MOBILE_UI.PROFILE_ERROR');
          return [];
        })
      )
      .subscribe();
  }

  private patchFromProfile(profile: UserProfile): void {
    this.personalForm.patchValue(
      {
        username: profile.username,
        email: profile.email,
        phone: profile.phone,
      },
      { emitEvent: false }
    );
    // Patch salary details array
    const arr = this.details;
    while (arr.length) arr.removeAt(0);
    if (Array.isArray(profile.salary) && profile.salary.length) {
      profile.salary.forEach((d) =>
        arr.push(this.createDetailGroup(d.label, d.amount))
      );
    } else {
      // Ensure at least one row exists for UX
      arr.push(this.createDetailGroup('Salary', 0));
    }
    this.salaryForm.patchValue(
      { currency: profile.currency },
      { emitEvent: false }
    );
    this.avatarUrl = profile.avatarUrl ?? null;
    this.personalForm.markAsPristine();
    this.salaryForm.markAsPristine();
    this.isPersonalFormDirty = false;
    this.isSalaryFormDirty = false;
  }

  hasUnsavedChanges(): boolean {
    const profile = this.profileService.getProfile();
    if (!profile || !this.personalForm || !this.salaryForm) return false;
    const currentPersonal = this.personalForm.getRawValue();
    const normalizePersonal = (value: any) => ({
      username: String(value?.username ?? '').trim(),
      email: String(value?.email ?? '').trim(),
      phone: String(value?.phone ?? '').trim(),
    });
    let currentSalary = this.details.getRawValue().map((d: any) => ({
      label: String(d?.label ?? '').trim(),
      amount: Number(d?.amount ?? 0),
    }));
    const savedSalary = (
      Array.isArray(profile.salary) ? profile.salary : []
    ).map((d) => ({
      label: String(d.label ?? '').trim(),
      amount: Number(d.amount ?? 0),
    }));
    if (
      !savedSalary.length &&
      currentSalary.length === 1 &&
      currentSalary[0].label === 'Salary' &&
      currentSalary[0].amount === 0
    )
      currentSalary = [];
    return (
      JSON.stringify(normalizePersonal(currentPersonal)) !==
        JSON.stringify(normalizePersonal(profile)) ||
      JSON.stringify(currentSalary) !== JSON.stringify(savedSalary) ||
      String(this.salaryForm.get('currency')?.getRawValue() ?? '') !==
        String(profile.currency ?? '')
    );
  }

  async confirmLeave(alertService: AlertService): Promise<boolean> {
    if (!this.hasUnsavedChanges()) return true;
    if (this.leaveConfirmationOpen) return false;
    this.leaveConfirmationOpen = true;
    try {
      const discard = await alertService.showConfirm({
        title: this.translate.instant('PROFILE.UNSAVED.TITLE'),
        message: this.translate.instant('PROFILE.UNSAVED.MESSAGE'),
        cancelText: this.translate.instant('PROFILE.UNSAVED.STAY'),
        confirmText: this.translate.instant('PROFILE.UNSAVED.DISCARD'),
        cssClass: 'alert-delete',
      });
      if (discard) this.patchFromProfile(this.profileService.getProfile()!);
      return discard;
    } finally {
      this.leaveConfirmationOpen = false;
    }
  }

  // Salary details helpers
  get details(): FormArray {
    return this.salaryForm.get('details') as FormArray;
  }

  private createDetailGroup(label: string = '', amount: number = 0) {
    const group = this.fb.group({
      id: [`detail-${this.nextDetailId++}`],
      label: [label, [Validators.required, Validators.maxLength(50)]],
      amount: [
        amount,
        [Validators.required, Validators.min(0), this.finiteAmountValidator],
      ],
    });
    // Re-run duplicate validation on label change
    group.get('label')?.valueChanges.subscribe(() => {
      this.details.updateValueAndValidity({ onlySelf: true, emitEvent: false });
      this.salaryForm.markAsDirty();
    });
    group.get('amount')?.valueChanges.subscribe(() => {
      this.details.updateValueAndValidity({ onlySelf: true, emitEvent: false });
      this.salaryForm.markAsDirty();
    });
    return group;
  }

  private finiteAmountValidator(
    control: AbstractControl
  ): ValidationErrors | null {
    const value = control.value;
    if (value === null || value === '') return null;
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0
      ? null
      : { invalidAmount: true };
  }

  addDetail(): void {
    this.details.push(this.createDetailGroup('Salary', 0));
    this.details.updateValueAndValidity();
    this.salaryForm.markAsDirty();
    this.isSalaryFormDirty = true;
  }

  removeDetail(id: string | null | undefined): void {
    const index = this.details.controls.findIndex(
      (ctrl) => ctrl.get('id')?.value === id
    );
    if (index > -1 && this.details.length > 1) {
      this.details.removeAt(index);
      this.details.updateValueAndValidity();
      this.salaryForm.markAsDirty();
      this.isSalaryFormDirty = true;
    }
  }

  // Ionic reorder handler for salary details
  onReorder(event: CustomEvent<ItemReorderEventDetail>): void {
    const from = event.detail.from;
    const to = event.detail.to;
    if (from === to) {
      event.detail.complete(true);
      return;
    }
    // Build new order array of existing controls
    const arr = this.details.controls as FormGroup[];
    const reordered = [...arr];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    // Clear and re-push to ensure proper parent binding
    while (this.details.length) {
      this.details.removeAt(0);
    }
    reordered.forEach((ctrl) => this.details.push(ctrl));

    this.details.updateValueAndValidity();
    this.salaryForm.markAsDirty();
    event.detail.complete(true);
  }

  trackByIndex(index: number, control: AbstractControl): string {
    return control.get('id')?.value || index.toString();
  }

  // Validator to prevent duplicate labels (case-insensitive, trimmed)
  private duplicateLabelsValidator(
    control: AbstractControl
  ): ValidationErrors | null {
    const arr = control as FormArray;
    const labels = arr.controls
      .map((c) =>
        String((c.get('label')?.value ?? '').toString().trim().toLowerCase())
      )
      .map((v, idx) => ({ v, idx }));
    const counts = new Map<string, number>();
    labels.forEach(({ v }) => counts.set(v, (counts.get(v) ?? 0) + 1));

    // Mark duplicates on individual controls
    labels.forEach(({ v, idx }) => {
      const ctrl = arr.at(idx).get('label');
      if (!ctrl) return;
      const isDup = v && (counts.get(v) ?? 0) > 1;
      const errors = ctrl.errors ?? {};
      if (isDup) {
        errors['duplicateLabel'] = true;
        ctrl.setErrors(errors);
      } else {
        if (errors['duplicateLabel']) {
          delete errors['duplicateLabel'];
          const hasOther = Object.keys(errors).length > 0 ? errors : null;
          ctrl.setErrors(hasOther);
        }
      }
    });

    // Overall array error if any duplicates
    const anyDup = Array.from(counts.values()).some((c) => c > 1);
    return anyDup ? ({ duplicateLabels: true } as ValidationErrors) : null;
  }

  // Total salary computed from details
  get totalSalary(): number {
    const values = (this.details.value || []) as Array<{
      label: string;
      amount: number;
    }>;
    return values.reduce((sum, d) => sum + (Number(d?.amount) || 0), 0);
  }

  // Calculate profile completion percentage
  get profileCompletion(): number {
    const profile = this.profileService.getProfile();
    if (!profile) return 0;

    let completedFields = 0;
    let totalFields = 5;

    // Check if fields are completed
    if (profile.username && profile.username.trim().length > 0)
      completedFields++;
    if (profile.email && profile.email.trim().length > 0) completedFields++;
    if (profile.phone && profile.phone.trim().length > 0) completedFields++;
    if (profile.avatarUrl && profile.avatarUrl.trim().length > 0)
      completedFields++;
    if (
      profile.salary &&
      profile.salary.length > 0 &&
      profile.salary[0].amount > 0
    )
      completedFields++;

    return Math.round((completedFields / totalFields) * 100);
  }

  // Get member since date
  getMemberSince(): string {
    const profile = this.profileService.getProfile();
    if (!profile || !profile.createdAt) {
      return '';
    }

    const date = new Date(profile.createdAt);
    if (Number.isNaN(date.getTime())) return '';
    const language =
      this.translate.currentLang || this.translate.getDefaultLang() || 'en';
    return date.toLocaleDateString(language.startsWith('ar') ? 'ar' : 'en', {
      month: 'short',
      year: 'numeric',
    });
  }

  savePersonal(): void {
    if (this.isLoadingPersonal$.value) return;
    if (this.personalForm.invalid) {
      this.personalForm.markAllAsTouched();
      this.toastService.presentErrorToast(
        'top',
        'PROFILE.TOASTS.PERSONAL_INVALID'
      );
      return;
    }
    this.isLoadingPersonal$.next(true);
    this.setLoading(true);
    this.errorMessage$.next(null);
    const personalValue = this.personalForm.getRawValue();
    this.profileService
      .updateProfile({
        username: String(personalValue.username ?? '').trim(),
        email: String(personalValue.email ?? '').trim(),
        phone: String(personalValue.phone ?? '').trim(),
      })
      .pipe(
        finalize(() => {
          this.isLoadingPersonal$.next(false);
          this.setLoading(false);
        }),
        takeUntil(this.destroy$),
        tap((updated) => {
          if (updated) {
            const value = this.personalForm.getRawValue();
            this.personalForm.patchValue(
              {
                username: String(value.username ?? '').trim(),
                email: String(value.email ?? '').trim(),
                phone: String(value.phone ?? '').trim(),
              },
              { emitEvent: false }
            );
            this.personalForm.markAsPristine();
            this.isPersonalFormDirty = false;
            this.toastService.presentSuccessToast(
              'top',
              'PROFILE.TOASTS.PERSONAL_SAVED'
            );
          } else {
            this.errorMessage$.next('PROFILE.TOASTS.PERSONAL_FAILED');
          }
        }),
        catchError((err) => {
          this.errorMessage$.next('PROFILE.TOASTS.PERSONAL_FAILED');
          return [];
        })
      )
      .subscribe();
  }

  saveSalary(): void {
    if (this.isLoadingSalary$.value) return;
    if (this.salaryForm.invalid) {
      this.salaryForm.markAllAsTouched();
      this.toastService.presentErrorToast(
        'top',
        'PROFILE.TOASTS.SALARY_INVALID'
      );
      return;
    }
    this.isLoadingSalary$.next(true);
    this.setLoading(true);
    this.errorMessage$.next(null);
    const detailsRaw = this.details.getRawValue() || [];
    const salaryPayload = detailsRaw.map(
      (d: { label?: unknown; amount?: unknown }) => ({
        label: String(d?.label ?? '').trim(),
        amount: Number(d?.amount),
      })
    );
    if (
      salaryPayload.some(
        (detail) =>
          !detail.label ||
          detail.label.length > 50 ||
          !Number.isFinite(detail.amount) ||
          detail.amount < 0
      )
    ) {
      this.salaryForm.markAllAsTouched();
      this.toastService.presentErrorToast(
        'top',
        'PROFILE.TOASTS.SALARY_INVALID'
      );
      return;
    }
    const currency = this.salaryForm.get('currency')?.getRawValue();
    const payload: Partial<UserProfile> = {
      salary: salaryPayload,
      currency,
    };

    this.profileService
      .updateProfile(payload)
      .pipe(
        finalize(() => {
          this.isLoadingSalary$.next(false);
          this.setLoading(false);
        }),
        takeUntil(this.destroy$),
        tap((updated) => {
          if (updated) {
            this.details.controls.forEach((control) => {
              const label = String(control.get('label')?.value ?? '').trim();
              const amount = Number(control.get('amount')?.value);
              control.patchValue({ label, amount }, { emitEvent: false });
            });
            this.salaryForm.markAsPristine();
            this.isSalaryFormDirty = false;
            this.toastService.presentSuccessToast(
              'top',
              'PROFILE.TOASTS.SALARY_SAVED'
            );
          } else {
            this.errorMessage$.next('PROFILE.TOASTS.SALARY_FAILED');
          }
        }),
        catchError((err) => {
          this.errorMessage$.next('PROFILE.TOASTS.SALARY_FAILED');
          return [];
        })
      )
      .subscribe();
  }

  triggerAvatarFile(): void {
    this.avatarInputRef?.nativeElement?.click();
  }

  async openAvatarActions(): Promise<void> {
    if (this.isLoadingAvatar$.value) return;

    const buttons = [
      {
        text: this.translate.instant('PROFILE.CHANGE_AVATAR'),
        icon: 'camera-outline',
        handler: () => this.triggerAvatarFile(),
      },
      ...(this.avatarUrl
        ? [
            {
              text: this.translate.instant('PROFILE.REMOVE_AVATAR'),
              icon: 'trash-outline',
              role: 'destructive' as const,
              handler: () => void this.removeAvatar(),
            },
          ]
        : []),
      {
        text: this.translate.instant('COMMON.CANCEL'),
        role: 'cancel' as const,
      },
    ];

    const actionSheet = await this.actionSheetController.create({
      header: this.translate.instant('PROFILE.AVATAR_ACTIONS_TITLE'),
      buttons,
    });

    await actionSheet.present();
  }

  async removeAvatar(): Promise<void> {
    if (this.isLoadingAvatar$.value || !this.avatarUrl) return;
    const confirmed = await this.alertService.showConfirm({
      title: this.translate.instant('PROFILE.REMOVE_AVATAR_TITLE'),
      message: this.translate.instant('PROFILE.REMOVE_AVATAR_MESSAGE'),
      confirmText: this.translate.instant('PROFILE.REMOVE_AVATAR_CONFIRM'),
      cancelText: this.translate.instant('COMMON.CANCEL'),
      cssClass: 'alert-destructive',
    });
    if (!confirmed) return;

    this.isLoadingAvatar$.next(true);
    this.setLoading(true);
    this.errorMessage$.next(null);
    this.profileService
      .removeAvatar()
      .pipe(
        finalize(() => {
          this.isLoadingAvatar$.next(false);
          this.setLoading(false);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((updated) => {
        if (!updated) {
          this.errorMessage$.next('PROFILE.TOASTS.AVATAR_REMOVE_FAILED');
          return;
        }
        this.avatarUrl = null;
        this.toastService.presentSuccessToast(
          'top',
          'PROFILE.TOASTS.AVATAR_REMOVED'
        );
      });
  }

  async onAvatarSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      this.toastService.presentErrorToast(
        'top',
        'PROFILE.TOASTS.INVALID_FILE_TYPE'
      );
      input.value = '';
      return;
    }

    if (file.size > this.avatarMaxSourceBytes) {
      this.toastService.presentErrorToast(
        'top',
        'PROFILE.TOASTS.FILE_TOO_LARGE'
      );
      input.value = '';
      return;
    }

    this.isPreparingAvatar$.next(true);
    try {
      await this.openCropEditor(file);
    } catch {
      this.cleanupCropEditor();
      this.toastService.presentErrorToast(
        'top',
        'PROFILE.TOASTS.AVATAR_PROCESSING_FAILED'
      );
    } finally {
      this.isPreparingAvatar$.next(false);
      input.value = '';
    }
  }

  cancelAvatarCrop(): void {
    this.cleanupCropEditor();
  }

  async confirmAvatarCrop(): Promise<void> {
    if (
      !this.cropImage ||
      !this.pendingAvatarFile ||
      this.isLoadingAvatar$.value
    )
      return;

    let file: File;
    try {
      file = await this.createCroppedAvatar();
    } catch {
      this.toastService.presentErrorToast(
        'top',
        'PROFILE.TOASTS.AVATAR_PROCESSING_FAILED'
      );
      return;
    }
    this.cleanupCropEditor();

    this.isLoadingAvatar$.next(true);
    this.setLoading(true);
    this.errorMessage$.next(null);
    this.profileService
      .uploadAvatar(file)
      .pipe(
        finalize(() => {
          this.isLoadingAvatar$.next(false);
          this.setLoading(false);
        }),
        takeUntil(this.destroy$),
        tap((res) => {
          if (res) {
            this.avatarUrl = res.avatarUrl ?? this.avatarUrl;
            this.showAvatarSuccess();
          } else {
            this.errorMessage$.next('PROFILE.TOASTS.AVATAR_FAILED');
          }
        }),
        catchError((err) => {
          this.errorMessage$.next('PROFILE.TOASTS.AVATAR_FAILED');
          return [];
        })
      )
      .subscribe();
  }

  private openCropEditor(file: File): Promise<void> {
    const sourceUrl = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          if (!image.naturalWidth || !image.naturalHeight)
            throw new Error('Unreadable image');
          this.cropImage = image;
          this.cropSourceUrl = sourceUrl;
          this.pendingAvatarFile = file;
          this.cropBaseScale =
            this.cropViewportSize /
            Math.min(image.naturalWidth, image.naturalHeight);
          this.cropZoom = 1;
          this.cropPanX = 0;
          this.cropPanY = 0;
          this.cropEditorOpen = true;
          resolve();
        } catch (error) {
          URL.revokeObjectURL(sourceUrl);
          reject(error);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(sourceUrl);
        reject(new Error('Unreadable image'));
      };
      image.src = sourceUrl;
    });
  }

  onCropZoom(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.cropZoom = Math.min(3, Math.max(1, value));
    this.clampCropPan();
    this.renderCrop();
  }

  onCropPointerDown(event: PointerEvent): void {
    if (!this.cropImage) return;
    const canvas = event.currentTarget as HTMLCanvasElement;
    canvas.setPointerCapture(event.pointerId);
    this.cropDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: this.cropPanX,
      panY: this.cropPanY,
    };
  }

  onCropPointerMove(event: PointerEvent): void {
    if (!this.cropDrag || this.cropDrag.pointerId !== event.pointerId) return;
    const canvas = event.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const factor = this.cropViewportSize / rect.width;
    this.cropPanX =
      this.cropDrag.panX + (event.clientX - this.cropDrag.startX) * factor;
    this.cropPanY =
      this.cropDrag.panY + (event.clientY - this.cropDrag.startY) * factor;
    this.clampCropPan();
    this.renderCrop();
  }

  onCropPointerUp(event: PointerEvent): void {
    const canvas = event.currentTarget as HTMLCanvasElement;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    this.cropDrag = undefined;
  }

  private clampCropPan(): void {
    if (!this.cropImage) return;
    const scale = this.cropBaseScale * this.cropZoom;
    const width = this.cropImage.naturalWidth * scale;
    const height = this.cropImage.naturalHeight * scale;
    const maxX = Math.max(0, (width - this.cropViewportSize) / 2);
    const maxY = Math.max(0, (height - this.cropViewportSize) / 2);
    this.cropPanX = Math.min(maxX, Math.max(-maxX, this.cropPanX));
    this.cropPanY = Math.min(maxY, Math.max(-maxY, this.cropPanY));
  }

  renderCrop(): void {
    const canvas = this.cropCanvasRef?.nativeElement;
    if (!canvas || !this.cropImage) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    this.clampCropPan();
    const scale = this.cropBaseScale * this.cropZoom;
    const width = this.cropImage.naturalWidth * scale;
    const height = this.cropImage.naturalHeight * scale;
    const left = (this.cropViewportSize - width) / 2 + this.cropPanX;
    const top = (this.cropViewportSize - height) / 2 + this.cropPanY;
    context.clearRect(0, 0, this.cropViewportSize, this.cropViewportSize);
    context.drawImage(this.cropImage, left, top, width, height);
  }

  private createCroppedAvatar(): Promise<File> {
    const canvas = document.createElement('canvas');
    canvas.width = this.avatarOutputSize;
    canvas.height = this.avatarOutputSize;
    const context = canvas.getContext('2d');
    if (!context || !this.cropImage)
      return Promise.reject(new Error('Crop unavailable'));
    this.clampCropPan();
    const outputScale = this.avatarOutputSize / this.cropViewportSize;
    const scale = this.cropBaseScale * this.cropZoom * outputScale;
    const width = this.cropImage.naturalWidth * scale;
    const height = this.cropImage.naturalHeight * scale;
    const left =
      ((this.cropViewportSize -
        this.cropImage.naturalWidth * this.cropBaseScale * this.cropZoom) /
        2 +
        this.cropPanX) *
      outputScale;
    const top =
      ((this.cropViewportSize -
        this.cropImage.naturalHeight * this.cropBaseScale * this.cropZoom) /
        2 +
        this.cropPanY) *
      outputScale;
    context.drawImage(this.cropImage, left, top, width, height);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(
                new File([blob], 'profile-avatar.jpg', { type: 'image/jpeg' })
              )
            : reject(new Error('Image compression failed')),
        'image/jpeg',
        0.82
      );
    });
  }

  private cleanupCropEditor(): void {
    if (this.cropSourceUrl) URL.revokeObjectURL(this.cropSourceUrl);
    this.cropSourceUrl = null;
    this.cropImage = null;
    this.pendingAvatarFile = null;
    this.cropDrag = undefined;
    this.cropEditorOpen = false;
  }

  private showAvatarSuccess(): void {
    this.toastService.presentSuccessToast('top', 'PROFILE.TOASTS.AVATAR_SAVED');
  }
}
