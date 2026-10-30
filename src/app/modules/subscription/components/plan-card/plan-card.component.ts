import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import {
  Plan,
  PlanSlug,
  Permission,
} from '../../../../shared/models/plan.model';
import { StorePackage } from '../../../../core/services/store-purchases.gateway';

@Component({
  selector: 'app-plan-card',
  templateUrl: './plan-card.component.html',
  styleUrls: ['./plan-card.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
})
export class PlanCardComponent {
  @Input() plan!: Plan;
  @Input() isCurrentPlan = false;
  @Input() isPopular = false;
  /** True when this device buys through the store (Google Play). */
  @Input() storeMode = false;
  /** Store offers that grant this plan, with the store's own prices. */
  @Input() storePackages: StorePackage[] = [];
  @Output() upgrade = new EventEmitter<Plan>();
  @Output() purchase = new EventEmitter<StorePackage>();

  onPurchase(pkg: StorePackage) {
    this.purchase.emit(pkg);
  }

  get isPaidPlan(): boolean {
    return this.plan.slug !== PlanSlug.FREE;
  }

  onUpgrade() {
    this.upgrade.emit(this.plan);
  }

  getFeatureTranslationKey(permission: Permission): string {
    // Convert permission to translation key
    // e.g., "category:create" -> "PLAN_FEATURES.CATEGORY_CREATE"
    const key = permission.replace(':', '_').toUpperCase();
    return `PLAN_FEATURES.${key}`;
  }

  getPlanColor(): string {
    const colors: Record<PlanSlug, string> = {
      [PlanSlug.FREE]: 'medium',
      [PlanSlug.BASIC]: 'primary',
      [PlanSlug.PRO]: 'secondary',
      [PlanSlug.ENTERPRISE]: 'tertiary',
    };
    return colors[this.plan.slug] || 'medium';
  }

  formatLimit(limit: number | null): string {
    return limit === null ? '∞' : limit.toString();
  }
}
