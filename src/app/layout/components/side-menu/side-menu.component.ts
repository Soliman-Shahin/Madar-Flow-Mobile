import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  ViewChild,
  AfterViewInit,
  inject,
} from '@angular/core';
import { NavigationEnd, RouterLink } from '@angular/router';
import { Observable, combineLatest } from 'rxjs';
import { filter, map, startWith } from 'rxjs/operators';
import { IonMenu, IonicModule } from '@ionic/angular';
import { BaseComponent } from 'src/app/shared/base/base.component';
import { MenuItem } from 'src/app/shared/models';
import { ThemeToggleComponent } from '../../../shared/components/theme-toggle/theme-toggle.component';
import { AsyncPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { SyncStatusComponent } from '../../../shared/components/sync-status/sync-status.component';
import { ProfileService } from '../../../modules/profile/services/profile.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-side-menu',
  templateUrl: './side-menu.component.html',
  styleUrls: ['./side-menu.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    IonicModule,
    RouterLink,
    ThemeToggleComponent,
    AsyncPipe,
    TranslateModule,
    SyncStatusComponent,
  ],
})
export class SideMenuComponent
  extends BaseComponent
  implements OnInit, AfterViewInit
{
  @ViewChild('menu') menu!: IonMenu;
  private navigationInProgress = false;
  private logoutInProgress = false;
  avatarFailed = false;
  private readonly profileService = inject(ProfileService);
  readonly notificationUnreadCount$ = inject(NotificationService).unreadCount$;

  private readonly activeLink$ = this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event: NavigationEnd) => event.url.split('?')[0]),
    startWith(this.router.url.split('?')[0])
  );

  vm$!: Observable<{
    profile: { user: any | null; isLoggedIn: boolean };
    storedProfile: { avatarUrl?: string } | null;
    links: MenuItem[];
    language: string;
    activeLink: string;
  }>;

  // Add method to close menu
  async closeMenu() {
    await this.menuCtrl?.close();
  }

  async navigateFromMenu(link: string): Promise<void> {
    if (this.navigationInProgress) return;
    this.navigationInProgress = true;
    try {
      await this.closeMenu();
      if (!this.isActive(link, this.router.url.split('?')[0])) {
        await this.router.navigateByUrl(link);
      }
    } finally {
      this.navigationInProgress = false;
    }
  }

  async onLogout(): Promise<void> {
    if (this.logoutInProgress) return;
    this.logoutInProgress = true;
    await this.closeMenu();
    this.logOut();
  }

  override ngOnInit() {
    super.ngOnInit();

    this.vm$ = combineLatest({
      profile: this.profile$,
      storedProfile: this.profileService.profile$,
      links: this.links$,
      language: this.language$,
      activeLink: this.activeLink$,
    });
  }

  protected override onUserChanged(): void {
    // The component shell survives auth transitions; never carry a prior
    // user's in-flight guard into the next session.
    this.logoutInProgress = false;
    this.avatarFailed = false;
  }

  onAvatarError(): void {
    this.avatarFailed = true;
  }

  onAvatarLoad(): void {
    this.avatarFailed = false;
  }

  onMenuOpen() {
    // Focus management when menu opens
    setTimeout(() => {
      const menuContent = document.querySelector('ion-menu ion-content');
      if (menuContent) {
        const focusable = menuContent.querySelector(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) as HTMLElement;
        if (focusable) {
          focusable.focus();
        }
      }
    }, 50);
  }

  async ngAfterViewInit() {
    // Initialize the menu
    this.initializeMenu();
  }

  private async initializeMenu() {
    try {
      await this.menuCtrl?.enable(true, 'main-menu');
    } catch (error) {
      console.error('Error initializing menu:', error);
    }
  }

  isActive(link: string, activeLink: string): boolean {
    const normalizedLink = link.replace(/\/$/, '') || '/';
    const normalizedActive = activeLink.replace(/\/$/, '') || '/';
    return (
      normalizedActive === normalizedLink ||
      normalizedActive.startsWith(`${normalizedLink}/`)
    );
  }

  initials(user: any | null): string {
    const value = user?.username || user?.fullName || user?.name || '';
    return (
      value
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part: string) => part[0])
        .join('')
        .toUpperCase() || '?'
    );
  }
}
