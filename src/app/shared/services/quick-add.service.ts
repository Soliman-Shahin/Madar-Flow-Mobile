import { Injectable, inject } from '@angular/core';
import { ledgerFormSheet } from 'src/app/shared/ui/sheet/sheet-options';
import { Router } from '@angular/router';
import { ModalController } from '@ionic/angular';
import { Subject, firstValueFrom, take } from 'rxjs';
import { ExpenseFormComponent } from 'src/app/home/components/expense-form/expense-form.component';
import { PlanService } from 'src/app/core/services/plan.service';

export type QuickAddHandler = () => void | Promise<void>;

/**
 * Global "add transaction" entry point used by the tab bar's center button.
 *
 * The visible page that owns a transactions view (Home, Transactions)
 * registers a handler so it keeps its own modal flow and refresh logic.
 * On any other page the service opens the form itself and announces the
 * save through `transactionSaved$` so cached views can refresh.
 */
@Injectable({ providedIn: 'root' })
export class QuickAddService {
  private readonly modalCtrl = inject(ModalController);
  private readonly planService = inject(PlanService);
  private readonly router = inject(Router);

  private readonly handlers: QuickAddHandler[] = [];
  private opening = false;

  readonly transactionSaved$ = new Subject<void>();

  /** Register the active page's handler. Returns an unregister function. */
  register(handler: QuickAddHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.lastIndexOf(handler);
      if (index >= 0) this.handlers.splice(index, 1);
    };
  }

  async requestAdd(): Promise<void> {
    const handler = this.handlers[this.handlers.length - 1];
    if (handler) {
      await handler();
      return;
    }
    await this.openDefault();
  }

  private async openDefault(): Promise<void> {
    if (this.opening) return;
    // Block only when the plan is known and its limit is reached; while the
    // plan is still loading the backend remains the source of truth (same
    // behaviour as the Transactions page).
    const plan = await firstValueFrom(
      this.planService.currentPlan$.pipe(take(1))
    );
    if (plan && !this.planService.canAddTransaction()) {
      await this.router.navigate(['/subscription'], {
        queryParams: {
          reason: 'limit_reached',
          limitType: 'SUBSCRIPTION.TRANSACTIONS_LIMIT',
        },
      });
      return;
    }
    this.opening = true;
    try {
      const modal = await this.modalCtrl.create({
        component: ExpenseFormComponent,
        ...ledgerFormSheet(),
      });
      await modal.present();
      const { role } = await modal.onDidDismiss();
      if (role === 'confirm' || role === 'delete') {
        this.transactionSaved$.next();
      }
    } finally {
      this.opening = false;
    }
  }
}
