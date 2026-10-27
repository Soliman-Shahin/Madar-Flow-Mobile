import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
} from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { NavigationEnd, RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { combineLatest } from 'rxjs';
import { filter, map, startWith, takeUntil } from 'rxjs/operators';
import { TABS_MENU_ITEMS } from 'src/app/core/constants';
import { BaseComponent } from 'src/app/shared/base';
import { Tab } from 'src/app/shared/models';
import { QuickAddService } from 'src/app/shared/services/quick-add.service';

@Component({
  standalone: true,
  selector: 'app-tabs-bar',
  templateUrl: './tabs-bar.component.html',
  styleUrls: ['./tabs-bar.component.scss'],
  imports: [CommonModule, RouterModule, IonicModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabsBarComponent extends BaseComponent implements OnInit {
  tabs: Tab[] = TABS_MENU_ITEMS;
  readonly visibleTabs: Tab[] = this.tabs.filter((tab) => tab.visible);
  /** The add action sits in the middle of the visible tabs. */
  readonly addSlotIndex = Math.ceil(this.visibleTabs.length / 2);
  private readonly quickAdd = inject(QuickAddService);
  private navigationInProgress = false;

  private readonly activeRoute$ = this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event: NavigationEnd) => event.urlAfterRedirects.split('?')[0]),
    startWith(this.router.url.split('?')[0]),
    takeUntil(this.destroy$)
  );

  readonly vm$ = combineLatest({
    isLoggedIn: this.authService.isLoggedIn$,
    activeRoute: this.activeRoute$,
  });

  constructor() {
    super();
  }

  navigateTab(link: string, event: Event): void {
    event.preventDefault();
    if (this.navigationInProgress || this.isActiveTab(link, this.router.url))
      return;
    this.navigationInProgress = true;
    void this.router.navigateByUrl(link, { replaceUrl: false }).finally(() => {
      this.navigationInProgress = false;
    });
  }

  addTransaction(): void {
    if (Capacitor.isNativePlatform()) {
      void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
    }
    void this.quickAdd.requestAdd();
  }

  isActiveTab(link: string, activeRoute: string): boolean {
    const base = link.replace(/\/$/, '') || '/';
    const current = activeRoute.split('?')[0].replace(/\/$/, '') || '/';
    return current === base || current.startsWith(`${base}/`);
  }

  override ngOnInit(): void {
    super.ngOnInit();
  }
}
