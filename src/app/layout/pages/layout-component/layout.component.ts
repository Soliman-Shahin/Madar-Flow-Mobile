import { AppNoticeComponent } from 'src/app/shared/components/app-notice/app-notice.component';
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { BaseComponent } from 'src/app/shared/base/base.component';
import { IonicModule } from '@ionic/angular';
import { SideMenuComponent } from '../../components/side-menu/side-menu.component';
import { TabsBarComponent } from '../../components/tabs-bar/tabs-bar.component';
import { AsyncPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { SyncIndicatorComponent } from 'src/app/shared/components/sync-indicator/sync-indicator.component';

@Component({
  selector: 'app-layout',
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    IonicModule,
    SideMenuComponent,
    TabsBarComponent,
    AsyncPipe,
    TranslateModule,
    SyncIndicatorComponent,
    AppNoticeComponent,
  ],
})
export class LayoutComponent extends BaseComponent implements OnInit {
  isLoggedIn$!: Observable<boolean>;
  message$!: Observable<string | null>;

  // The global overlay is driven ONLY by LoadingService.isLoading$.
  // We deliberately do NOT use the inherited `isLoading` getter from
  // BaseComponent here — that getter reads ComponentStateService.loading(),
  // which is a single app-wide signal shared by every component that
  // extends BaseComponent. Any unrelated component calling
  // this.setLoading()/this.state.setLoading() would flip that same
  // signal and could open/close this overlay unexpectedly.
  isGlobalLoading$!: Observable<boolean>;

  constructor() {
    super();
  }

  override ngOnInit(): void {
    super.ngOnInit();
    this.isLoggedIn$ = this.authService.isLoggedIn$;
    this.message$ = this.loadingService.message$;
    this.isGlobalLoading$ = this.loadingService.isLoading$;

    // Intentionally not subscribing to loadingService.isLoading$ here to
    // call this.setLoading(...) anymore — the template binds directly to
    // isGlobalLoading$ via the async pipe instead. This removes the extra
    // hop through ComponentStateService (a shared, app-wide signal) that
    // was causing the overlay to get stuck or get toggled by unrelated
    // components.
  }
}
