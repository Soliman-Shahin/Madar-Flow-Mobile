import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { PlanService } from 'src/app/core/services/plan.service';
import { UpgradePromptComponent } from './upgrade-prompt.component';

describe('UpgradePromptComponent', () => {
  let plan$: BehaviorSubject<{ upgradeAvailable?: boolean } | null>;

  const render = () => {
    const fixture = TestBed.createComponent(UpgradePromptComponent);
    fixture.detectChanges();
    return fixture;
  };
  const button = (el: HTMLElement) => el.querySelector('ion-button');
  const note = (el: HTMLElement) => el.querySelector('ion-note');

  beforeEach(() => {
    plan$ = new BehaviorSubject<{ upgradeAvailable?: boolean } | null>(null);
    TestBed.configureTestingModule({
      imports: [IonicModule.forRoot(), TranslateModule.forRoot()],
      providers: [
        { provide: PlanService, useValue: { currentPlan$: plan$.asObservable() } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
      ],
    });
  });

  it('shows the upgrade button before the plan is known and on older servers', () => {
    const fixture = render();
    expect(button(fixture.nativeElement)).toBeTruthy();
    expect(note(fixture.nativeElement)).toBeNull();

    plan$.next({}); // field missing => treated as available
    fixture.detectChanges();
    expect(button(fixture.nativeElement)).toBeTruthy();
  });

  it('shows the upgrade button when the server allows upgrades', () => {
    plan$.next({ upgradeAvailable: true });
    const fixture = render();
    expect(button(fixture.nativeElement)).toBeTruthy();
  });

  it('replaces the button with "coming soon" when the server has closed purchases', () => {
    plan$.next({ upgradeAvailable: false });
    const fixture = render();
    expect(button(fixture.nativeElement)).toBeNull();
    expect(note(fixture.nativeElement)).toBeTruthy();
  });
});
