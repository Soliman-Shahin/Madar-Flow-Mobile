import { Component, Input } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { MyPlanResponse } from '../../../../shared/models/plan.model';

interface UsageMeter {
  key: string;
  icon: string;
  label: string;
  used: number;
  limit: number | null;
  percentage: number;
}

@Component({
  selector: 'app-usage-stats',
  templateUrl: './usage-stats.component.html',
  styleUrls: ['./usage-stats.component.scss'],
  standalone: true,
  imports: [IonicModule, TranslateModule],
})
export class UsageStatsComponent {
  @Input() planData!: MyPlanResponse;

  get meters(): UsageMeter[] {
    const { categories, transactionsThisMonth } = this.planData.usage;
    return [
      {
        key: 'categories',
        icon: 'folder-outline',
        label: 'SUBSCRIPTION.CATEGORIES_LIMIT',
        ...categories,
      },
      {
        key: 'transactions',
        icon: 'receipt-outline',
        label: 'SUBSCRIPTION.TRANSACTIONS_LIMIT',
        ...transactionsThisMonth,
      },
    ];
  }

  /** Quiet by default; warm only when the limit is close. */
  level(percentage: number): 'ok' | 'warn' | 'high' {
    if (percentage >= 90) return 'high';
    if (percentage >= 75) return 'warn';
    return 'ok';
  }

  clamp(percentage: number): number {
    return Math.min(100, Math.max(0, percentage));
  }

  formatLimit(limit: number | null): string {
    return limit === null ? '∞' : limit.toString();
  }

  formatDate(date: Date | null): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString();
  }
}
