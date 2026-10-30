import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router, ActivatedRoute } from '@angular/router';
import { PlanService } from '../../core/services/plan.service';
import { ToastService } from '../../shared/services/toast.service';
import {
  Plan,
  PlanSlug,
  MyPlanResponse,
  getPlanColor,
} from '../../shared/models/plan.model';
import { PlanCardComponent } from './components/plan-card/plan-card.component';
import { UsageStatsComponent } from './components/usage-stats/usage-stats.component';
import { SkeletonBlockComponent } from '../../shared/ui/skeleton-block/skeleton-block.component';

@Component({
  selector: 'app-subscription',
  templateUrl: './subscription.page.html',
  styleUrls: ['./subscription.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    TranslateModule,
    PlanCardComponent,
    UsageStatsComponent,
    SkeletonBlockComponent,
  ],
})
export class SubscriptionPage implements OnInit {
  private planService = inject(PlanService);
  private toastService = inject(ToastService);
  private translateService = inject(TranslateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private changeDetectorRef = inject(ChangeDetectorRef);

  // State
  availablePlans: Plan[] = [];
  currentPlan: MyPlanResponse | null = null;
  selectedSegment: 'plans' | 'usage' = 'plans';
  isLoading = false;
  loadError = false;
  private isChangingPlan = false;
  from?: string;

  // Query params (for redirects from guards/interceptors)
  reason?: string;
  limitType?: string;
  permission?: string;

  async ngOnInit() {
    // Get query params
    this.route.queryParams.subscribe((params) => {
      this.reason = params['reason'];
      this.limitType = params['limitType'];
      this.permission = params['permission'];
      this.from = params['from'];
    });

    await this.loadData();
  }

  async loadData() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.loadError = false;

    try {
      // Load available plans and current plan in parallel
      const [plans, myPlan] = await Promise.all([
        this.planService.getAvailablePlans(),
        this.planService.getMyPlan(),
      ]);

      this.availablePlans = plans;
      this.currentPlan = myPlan;
      this.changeDetectorRef.markForCheck();

      // Show contextual message based on reason
      this.showContextualMessage();
    } catch (error) {
      console.warn('Subscription data unavailable');
      this.loadError = true;
      await this.toastService.show({
        message: 'SUBSCRIPTION.LOAD_FAILED',
        color: 'danger',
        duration: 3000,
        position: 'bottom',
      });
    } finally {
      this.isLoading = false;
    }
  }

  private showContextualMessage() {
    if (!this.reason) return;

    let message = '';
    switch (this.reason) {
      case 'limit_exceeded':
        message = 'SUBSCRIPTION.LIMIT_REACHED_MSG';
        break;
      case 'permission_denied':
        message = 'SUBSCRIPTION.FEATURE_LOCKED_MSG';
        break;
      case 'expired':
        message = 'SUBSCRIPTION.PLAN_EXPIRED';
        break;
    }

    if (message) {
      setTimeout(() => {
        this.toastService.show({
          message,
          color: 'warning',
          duration: 4000,
          position: 'bottom',
        });
      }, 500);
    }
  }

  async onUpgrade(plan: Plan) {
    if (this.isChangingPlan || this.isLoading) return;
    // The server closes purchases until a payment provider is connected.
    if (this.currentPlan?.upgradeAvailable === false) {
      await this.toastService.show({
        message: 'SUBSCRIPTION.UPGRADE_UNAVAILABLE',
        color: 'medium',
        duration: 3500,
        position: 'bottom',
      });
      return;
    }
    // Don't allow downgrade to free
    if (plan.slug === PlanSlug.FREE) {
      await this.toastService.show({
        message: 'SUBSCRIPTION.DOWNGRADE_CONTACT_SUPPORT',
        color: 'warning',
        duration: 3000,
        position: 'bottom',
      });
      return;
    }

    // Check if already on this plan
    if (this.currentPlan?.context.planSlug === plan.slug) {
      await this.toastService.show({
        message: 'SUBSCRIPTION.ALREADY_ON_PLAN',
        color: 'medium',
        duration: 2000,
        position: 'bottom',
      });
      return;
    }

    this.isChangingPlan = true;
    try {
      await this.planService.upgradePlan(plan.slug);
      const refreshedPlan = await this.planService.getMyPlan();
      this.currentPlan = refreshedPlan;
      this.changeDetectorRef.markForCheck();

      await this.toastService.show({
        message: this.translateService.instant('SUBSCRIPTION.UPGRADE_SUCCESS', {
          plan: plan.name,
        }),
        color: 'success',
        duration: 3000,
        position: 'bottom',
      });

      // Reload data
      this.loadError = false;
    } catch (error: any) {
      console.warn('Subscription upgrade unavailable');
      await this.toastService.show({
        message: 'SUBSCRIPTION.UPGRADE_FAILED',
        color: 'danger',
        duration: 3000,
        position: 'bottom',
      });
    } finally {
      this.isChangingPlan = false;
    }
  }

  segmentChanged(event: any) {
    this.selectedSegment = event.detail.value;
  }

  getPlanColor(slug: PlanSlug): string {
    return getPlanColor(slug);
  }

  isCurrentPlan(plan: Plan): boolean {
    return this.currentPlan?.context.planSlug === plan.slug;
  }

  goBack() {
    if (this.from === 'settings') {
      this.router.navigate(['/settings']);
    } else {
      this.router.navigate(['/home']);
    }
  }
}
