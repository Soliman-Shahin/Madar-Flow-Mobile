import { Component, ChangeDetectionStrategy, OnInit } from '@angular/core';
import {
  FormControl,
  FormGroup,
  Validators,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { BehaviorSubject, combineLatest, finalize, takeUntil } from 'rxjs';
import { BaseComponent } from 'src/app/shared/base';
import { IonicModule } from '@ionic/angular';
import { AsyncPipe } from '@angular/common';
import { UiInputComponent } from '../../../../shared/ui/ui-input/ui-input.component';
import { ColorSelectorComponent } from '../../containers/color-selector/color-selector.component';
import { IconSelectorComponent } from '../../containers/icon-selector/icon-selector.component';
import { TranslateModule } from '@ngx-translate/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-add-category',
  templateUrl: './add-category.component.html',
  styleUrls: ['./add-category.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    IonicModule,
    FormsModule,
    ReactiveFormsModule,
    UiInputComponent,
    ColorSelectorComponent,
    IconSelectorComponent,
    AsyncPipe,
    TranslateModule,
    RouterModule,
  ],
})
export class AddCategoryComponent extends BaseComponent implements OnInit {
  categoryForm!: FormGroup;
  editMode = false;
  categoryId: string | null = null;
  animatePreview = false;
  formSubmitted = false;

  private readonly loading = new BehaviorSubject<boolean>(false);
  private readonly errorMessage = new BehaviorSubject<string>('');
  readonly vm$ = combineLatest({
    isLoading: this.loading.asObservable(),
    errorMessage: this.errorMessage.asObservable(),
  });

  constructor() {
    super();
  }

  override ngOnInit() {
    this.initFormGroup();
    this.activatedRoute.params
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        this.categoryId = params['id'];
        this.editMode = !!this.categoryId;
        if (this.editMode) {
          this.loadCategory();
        }
      });

    // Animate preview on title changes
    const titleCtrl = this.categoryForm.get('title');
    titleCtrl?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.bumpPreview());
  }

  private initFormGroup(category?: any): void {
    this.categoryForm = this.fb.group({
      title: [
        category?.title || '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.pattern(/^(?!\s*$).+/), // not only whitespace
        ],
      ],
      icon: [category?.icon || 'add', Validators.required],
      color: [category?.color || '#28ba62', Validators.required],
      type: [category?.type || 'outcome', Validators.required],
    });
  }

  selectColor(color: string) {
    this.categoryForm.patchValue({ color });
    this.bumpPreview();
    this.addHapticFeedback();
  }

  selectIcon(icon: string) {
    this.categoryForm.patchValue({ icon });
    this.bumpPreview();
    this.addHapticFeedback();
  }

  private addHapticFeedback() {
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }
  }

  private bumpPreview() {
    this.animatePreview = true;
    setTimeout(() => (this.animatePreview = false), 220);
  }

  loadCategory() {
    if (this.categoryId) {
      this.loading.next(true);
      this.errorMessage.next('');
      this.categoryService
        .getCategory(this.categoryId)
        .pipe(
          takeUntil(this.destroy$),
          finalize(() => this.loading.next(false))
        )
        .subscribe({
          next: (category) => {
            this.categoryForm.patchValue({
              title: category.title || '',
              icon: category.icon || 'add',
              color: category.color || '#28ba62',
              type: category.type || 'outcome',
            });
            this.cdr.markForCheck(); // Trigger change detection for OnPush
          },
          error: (error) => {
            this.errorMessage.next('COMMON.ERRORS.LOAD_DATA');
          },
        });
    }
  }

  addCategory(): void {
    if (this.loading.getValue()) return;
    this.formSubmitted = true;
    if (this.categoryForm.invalid) {
      return;
    }
    const title = String(this.categoryForm.get('title')?.value ?? '').trim();
    this.categoryForm.patchValue({ title }, { emitEvent: false });
    if (!title) return;
    this.loading.next(true);
    this.errorMessage.next('');
    this.categoryService
      .createCategory(this.categoryForm.getRawValue())
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.loading.next(false);
          setTimeout(() => (this.formSubmitted = false), 2000);
        })
      )
      .subscribe({
        next: () => {
          this.toastService.presentSuccessToast(
            'bottom',
            this.translateService.instant('CATEGORY.SUCCESSFULLY_ADDED')
          );
          setTimeout(() => {
            this.router.navigate(['/categories/list']);
          }, 1500);
        },
        error: (error) => {
          this.formSubmitted = false;
          this.errorMessage.next('COMMON.ERRORS.DEFAULT');
        },
      });
  }

  updateCategory(): void {
    if (
      !this.categoryId ||
      this.loading.getValue() ||
      !this.categoryForm.dirty
    ) {
      return;
    }

    const title = String(this.categoryForm.get('title')?.value ?? '').trim();
    this.categoryForm.patchValue({ title }, { emitEvent: false });
    if (!title) return;
    this.loading.next(true);
    this.errorMessage.next('');
    this.categoryService
      .updateCategory(this.categoryId, this.categoryForm.getRawValue())
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.loading.next(false))
      )
      .subscribe({
        next: () => {
          this.toastService.presentSuccessToast(
            'bottom',
            this.translateService.instant('CATEGORY.SUCCESSFULLY_UPDATED')
          );
          this.router.navigate(['/categories/list']);
        },
        error: (error) => {
          this.errorMessage.next('COMMON.ERRORS.DEFAULT');
        },
      });
  }
}
