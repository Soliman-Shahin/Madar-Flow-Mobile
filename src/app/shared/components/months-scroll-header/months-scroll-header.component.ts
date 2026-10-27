import {
  Component,
  ChangeDetectionStrategy,
  EventEmitter,
  Input,
  Output,
  OnInit,
  AfterViewInit,
  ViewChild,
  ElementRef,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { MonthYear } from 'src/app/home/models';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-months-scroll-header',
  templateUrl: './months-scroll-header.component.html',
  styleUrls: ['./months-scroll-header.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [DatePipe],
})
export class MonthsScrollHeaderComponent
  implements OnInit, AfterViewInit, OnChanges, OnDestroy
{
  @Input() selectedDate: MonthYear | undefined;
  @Input() locale: string | undefined;
  @Output() monthSelected = new EventEmitter<MonthYear>();
  @Output() scrolled = new EventEmitter<{
    isAtStart: boolean;
    isAtEnd: boolean;
  }>();

  @ViewChild('monthsContainer') monthsContainer!: ElementRef;

  months: MonthYear[] = [];
  private _didInitialForceCenter = false;
  private _initialForceTries = 0;

  constructor() {}

  ngOnInit(): void {
    this.generateMonths();
    if (!this.selectedDate) {
      const today = new Date();
      this.selectedDate = {
        month: today.getMonth() + 1,
        year: today.getFullYear(),
      };
    }
    // Attempt to center after initial setup
    setTimeout(() => this.scrollToSelected());
  }

  ngAfterViewInit(): void {
    // Defer to next tick to ensure *ngFor has rendered and classes are applied
    setTimeout(() => this.scrollToSelected());
    // One-time hard alignment to guarantee visibility on first paint
    requestAnimationFrame(() =>
      setTimeout(() => this.forceCenterSelectedOnce(), 0)
    );
    // A language switch flips the strip's direction while the page may be
    // hidden (zero width); re-center once it has a size again.
    if (typeof ResizeObserver !== 'undefined' && this.monthsContainer) {
      this.resizeObserver = new ResizeObserver(() => this.recenterIfPending());
      this.resizeObserver.observe(this.monthsContainer.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.clearAutoTimers();
  }

  private recenterPending = false;
  private resizeObserver?: ResizeObserver;

  private recenterIfPending(): void {
    const container = this.monthsContainer?.nativeElement as
      | HTMLElement
      | undefined;
    if (!this.recenterPending || !container || container.clientWidth === 0) {
      return;
    }
    const index = this.selectedDate
      ? this.months.findIndex(
          (m) =>
            m.year === this.selectedDate!.year &&
            m.month === this.selectedDate!.month
        )
      : -1;
    const child = container.children.item(index) as HTMLElement | null;
    if (!child) return;
    this.recenterPending = false;
    container.scrollBy({ left: this.centerDelta(container, child) });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['locale'] && !changes['locale'].firstChange) {
      this.recenterPending = true;
      requestAnimationFrame(() => this.recenterIfPending());
    }
    if (changes['selectedDate'] && this.selectedDate) {
      // When parent updates or sets the selected date, ensure we reflect it and scroll
      setTimeout(() => this.scrollToSelected());
      // If selectedDate arrives late from parent, ensure we run the force center once
      if (!this._didInitialForceCenter) {
        requestAnimationFrame(() =>
          setTimeout(() => this.forceCenterSelectedOnce(), 0)
        );
      }
    }
  }

  generateMonths(): void {
    const today = new Date();
    const months: MonthYear[] = [];
    for (let i = 0; i < 12; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push({ month: date.getMonth() + 1, year: date.getFullYear() });
    }
    this.months = months.reverse();
    // Center after months render in the next ticks
    requestAnimationFrame(() => this.scrollToSelected());
    setTimeout(() => this.scrollToSelected(), 0);
    // Ensure a one-time hard center after data is ready
    if (!this._didInitialForceCenter) {
      requestAnimationFrame(() =>
        setTimeout(() => this.forceCenterSelectedOnce(), 0)
      );
    }
  }

  selectMonth(month: MonthYear): void {
    this.selectedDate = month;
    this.monthSelected.emit(month);
    this.scrollToSelected();
  }

  isSelected(month: MonthYear): boolean {
    if (!this.selectedDate) {
      return false;
    }
    return (
      month.year === this.selectedDate.year &&
      month.month === this.selectedDate.month
    );
  }

  // Helper to create a Date object from MonthYear for the pipe
  getDate(monthYear: MonthYear): Date {
    return new Date(monthYear.year, monthYear.month - 1, 1);
  }

  onScroll(): void {
    this.updateScrollPosition();
  }

  private updateScrollPosition(): void {
    if (!this.monthsContainer) return;

    const container = this.monthsContainer.nativeElement;
    const isAtStart = container.scrollLeft <= 0;
    const isAtEnd =
      container.scrollLeft + container.clientWidth >= container.scrollWidth - 1; // Allow 1px tolerance

    this.scrolled.emit({ isAtStart, isAtEnd });
  }

  private scrollToSelected(): void {
    if (this.isUserInteracting || this.isAutoScrolling) return; // do not auto-scroll during user interaction or while already auto-scrolling
    const container = this.monthsContainer?.nativeElement;
    if (!container) return;

    const doScroll = () => {
      if (this.isUserInteracting) return; // guard inside deferred callbacks
      if (!container) return;
      if (!this.selectedDate || !this.months || this.months.length === 0) {
        return;
      }
      const index = this.months.findIndex(
        (m) =>
          m.year === this.selectedDate!.year &&
          m.month === this.selectedDate!.month
      );
      if (index < 0) return;

      const child = container.children.item(index) as HTMLElement | null;
      if (!child) return;

      container.scrollBy({
        left: this.centerDelta(container, child),
        behavior: 'smooth',
      });

      // Single lightweight update; avoid repeated retries to prevent fighting the user
      this.scheduleAuto(() => {
        if (!this.isUserInteracting) this.updateScrollPosition();
        this.isAutoScrolling = false;
      }, 140);
    };

    // Try immediately, then defer to next frame and short timeout as a safety net
    this.clearAutoTimers();
    this.isAutoScrolling = true;
    doScroll();
  }

  // Force center the selected month once on first load, bypassing interaction guards and smooth scrolling.
  private forceCenterSelectedOnce(): void {
    if (this._didInitialForceCenter) return;
    const container = this.monthsContainer?.nativeElement as
      | HTMLElement
      | undefined;
    if (!container || !this.selectedDate || !this.months?.length) return;
    // If container not laid out yet (hidden tab or width 0), retry a few times then give up
    if (container.clientWidth === 0) {
      if (this._initialForceTries < 3) {
        this._initialForceTries++;
        setTimeout(() => this.forceCenterSelectedOnce(), 60);
      }
      return;
    }
    const index = this.months.findIndex(
      (m) =>
        m.year === this.selectedDate!.year &&
        m.month === this.selectedDate!.month
    );
    if (index < 0) return;
    const child = container.children.item(index) as HTMLElement | null;
    if (!child || child.clientWidth === 0) {
      if (this._initialForceTries < 3) {
        this._initialForceTries++;
        setTimeout(() => this.forceCenterSelectedOnce(), 60);
      }
      return;
    }
    container.scrollBy({ left: this.centerDelta(container, child) });
    this._didInitialForceCenter = true;
  }

  /**
   * Horizontal distance from the strip's center to the month's center, on
   * screen. scrollBy takes a physical delta, so the same value centers the
   * month in both LTR and RTL without per-engine scrollLeft conventions.
   */
  private centerDelta(container: HTMLElement, child: HTMLElement): number {
    const c = container.getBoundingClientRect();
    const m = child.getBoundingClientRect();
    return m.left + m.width / 2 - (c.left + c.width / 2);
  }

  // Accessibility and display helpers

  getAriaLabel(month: MonthYear): string {
    const date = this.getDate(month);
    const dateText = date.toLocaleDateString(this.locale || undefined, {
      month: 'long',
      year: 'numeric',
    });
    return `${dateText}`;
  }

  onKeydown(ev: KeyboardEvent, month: MonthYear): void {
    const key = ev.key;
    if (key === 'Enter' || key === ' ') {
      ev.preventDefault();
      this.selectMonth(month);
    }
  }

  // --- Interaction guards to avoid fighting the user ---
  private isUserInteracting = false;
  private autoTimers: number[] = [];
  private wheelEndTimer: number | null = null;
  private isAutoScrolling = false;

  onPointerDown(): void {
    this.isUserInteracting = true;
    this.clearAutoTimers();
  }

  onPointerUp(): void {
    // allow momentum to finish then re-center
    this.isUserInteracting = false;
    this.clearAutoTimers();
    this.scheduleAuto(() => {
      if (!this.isUserInteracting) {
        this.updateScrollPosition();
      }
    }, 250);
  }

  onUserWheel(): void {
    this.isUserInteracting = true;
    this.clearAutoTimers();
    if (this.wheelEndTimer) {
      clearTimeout(this.wheelEndTimer);
    }
    this.wheelEndTimer = window.setTimeout(() => {
      this.isUserInteracting = false;
      this.updateScrollPosition();
      this.wheelEndTimer = null;
    }, 300);
  }

  private scheduleAuto(fn: () => void, delay: number): void {
    const id = window.setTimeout(fn, delay);
    this.autoTimers.push(id);
  }

  private clearAutoTimers(): void {
    for (const id of this.autoTimers) clearTimeout(id);
    this.autoTimers = [];
  }
}
