import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  inject,
} from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Full-screen receipt viewer. The picture fits the screen to start; pinch to
 * zoom up to 4x, drag to move once zoomed, double-tap to jump between fit and
 * 2.5x. Opens as a full-screen modal on a black ground so the paper reads
 * clearly; the close button sits inside the safe area.
 */
@Component({
  selector: 'app-receipt-viewer',
  standalone: true,
  imports: [IonicModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rv" role="dialog" aria-modal="true" [attr.aria-label]="title || ('RECEIPT.RECEIPT' | translate)">
      <header class="rv__bar">
        <button type="button" class="rv__close" (click)="close()" [attr.aria-label]="'COMMON.CLOSE' | translate">
          <ion-icon name="close" aria-hidden="true"></ion-icon>
        </button>
        @if (title) {
        <strong class="rv__title" dir="auto">{{ title }}</strong>
        }
        @if (scale > 1) {
        <button type="button" class="rv__reset" (click)="reset()">{{ 'RECEIPT.FIT' | translate }}</button>
        }
      </header>
      <div
        class="rv__stage"
        (pointerdown)="down($event)"
        (pointermove)="move($event)"
        (pointerup)="up($event)"
        (pointercancel)="up($event)"
        (dblclick)="toggle()"
      >
        <img
          class="rv__img"
          [src]="src"
          alt=""
          draggable="false"
          [style.transform]="'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')'"
        />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .rv {
        position: relative;
        height: 100%;
        background: #000;
        color: #fff;
        font-family: var(--mf-font-sans);
      }
      .rv__bar {
        position: absolute;
        inset-inline: 0;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: var(--mf-space-3);
        padding: calc(env(safe-area-inset-top, 0px) + var(--mf-space-2))
          var(--mf-space-3) var(--mf-space-3);
        background: linear-gradient(rgb(0 0 0 / 0.6), rgb(0 0 0 / 0));
      }
      .rv__close,
      .rv__reset {
        min-width: var(--mf-touch-target);
        min-height: var(--mf-touch-target);
        border: 0;
        border-radius: 999px;
        background: rgb(255 255 255 / 0.16);
        color: #fff;
        font: inherit;
        cursor: pointer;
      }
      .rv__close {
        display: grid;
        place-items: center;
        font-size: 24px;
      }
      .rv__reset {
        margin-inline-start: auto;
        padding: 0 var(--mf-space-4);
        font-size: var(--mf-text-footnote);
        font-weight: var(--mf-weight-semibold);
      }
      .rv__title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--mf-text-callout);
        font-weight: var(--mf-weight-semibold);
      }
      .rv__stage {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        overflow: hidden;
        /* the app handles pinch and drag itself */
        touch-action: none;
        user-select: none;
      }
      .rv__img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        transform-origin: center;
        will-change: transform;
        pointer-events: none;
      }
      button:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
      }
    `,
  ],
})
export class ReceiptViewerComponent {
  private readonly modal = inject(ModalController);
  private readonly cdr = inject(ChangeDetectorRef);

  @Input() src = '';
  @Input() title = '';

  scale = 1;
  x = 0;
  y = 0;

  private pointers = new Map<number, { x: number; y: number }>();
  private startDistance = 0;
  private startScale = 1;
  private lastTap = 0;

  @HostListener('document:keydown.escape')
  close(): void {
    void this.modal.dismiss();
  }

  reset(): void {
    this.scale = 1;
    this.x = 0;
    this.y = 0;
    this.cdr.markForCheck();
  }

  toggle(): void {
    if (this.scale > 1) this.reset();
    else {
      this.scale = 2.5;
      this.cdr.markForCheck();
    }
  }

  down(e: PointerEvent): void {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      this.startDistance = this.distance();
      this.startScale = this.scale;
    } else if (this.pointers.size === 1) {
      // a quick second tap zooms (touch screens do not send dblclick reliably)
      const now = Date.now();
      if (now - this.lastTap < 300) this.toggle();
      this.lastTap = now;
    }
  }

  move(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    this.pointers.set(e.pointerId, next);
    if (this.pointers.size === 2 && this.startDistance > 0) {
      const ratio = this.distance() / this.startDistance;
      this.scale = Math.min(4, Math.max(1, this.startScale * ratio));
      if (this.scale === 1) {
        this.x = 0;
        this.y = 0;
      }
    } else if (this.pointers.size === 1 && this.scale > 1) {
      this.x += next.x - prev.x;
      this.y += next.y - prev.y;
    }
    this.cdr.markForCheck();
  }

  up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.startDistance = 0;
    if (this.scale <= 1.02) this.reset();
  }

  private distance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }
}
