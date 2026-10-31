
import { Component, ChangeDetectionStrategy, EventEmitter, Input, Output } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { COLORS } from '../../models';

@Component({
  standalone: true,
  imports: [IonicModule, TranslateModule],
  selector: 'app-color-selector',
  templateUrl: './color-selector.component.html',
  styleUrls: ['./color-selector.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ColorSelectorComponent {
  @Output() color = new EventEmitter<string>();
  @Input() selectedColor?: string;
  
  colors: any[] = COLORS;

  constructor() {}

  selectColor(color: any) {
    this.selectedColor = color.colorCode;
    this.color.emit(color.colorCode);
  }

  selectColors(event: any) {
    this.selectedColor = event.target.value;
    this.color.emit(event.target.value);
  }

  trackByColor(index: number, color: any): string {
    return color.colorCode;
  }
}
