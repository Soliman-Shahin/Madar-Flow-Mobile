/* tslint:disable:no-unused-variable */
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IconSelectorComponent } from './icon-selector.component';

describe('IconSelectorComponent', () => {
  let component: IconSelectorComponent;
  let fixture: ComponentFixture<IconSelectorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IconSelectorComponent],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(IconSelectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('updates the selected icon and emits the selection', () => {
    spyOn(component.icon, 'emit');

    component.selectIcon('restaurant');

    expect(component.selectedIcon).toBe('restaurant');
    expect(component.icon.emit).toHaveBeenCalledOnceWith('restaurant');
  });

  it('uses the icon value as the stable tracking key', () => {
    expect(component.trackByIcon(3, 'restaurant')).toBe('restaurant');
  });
});
