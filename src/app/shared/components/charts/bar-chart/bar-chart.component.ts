import {
  Component,
  ChangeDetectionStrategy,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  OnInit,
  OnDestroy,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { DirectionService } from 'src/app/core/services/direction.service';
import { BaseComponent } from 'src/app/shared/base/base.component';
import { takeUntil } from 'rxjs/operators';
import {
  trigger,
  transition,
  style,
  animate,
  query,
  stagger,
} from '@angular/animations';
import {
  ChartTooltipComponent,
  TooltipData,
} from '../../ui/chart-tooltip/chart-tooltip.component';
import {
  CHART_DATA,
  CHART_TITLE,
  CHART_ARIA_LABEL,
  CHART_DESCRIPTION,
} from '../chart.tokens';

interface ChartData {
  name: string;
  value: number;
  color?: string;
}

@Component({
  selector: 'app-bar-chart',
  standalone: true,
  imports: [CommonModule, ChartTooltipComponent, TranslateModule],
  templateUrl: './bar-chart.component.html',
  styleUrls: ['./bar-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('barAnimation', [
      transition('* => *', [
        query(
          ':enter',
          [
            style({ opacity: 0, transform: 'translateY(20px)' }),
            stagger(50, [
              animate(
                '300ms ease-out',
                style({ opacity: 1, transform: 'translateY(0)' })
              ),
            ]),
          ],
          { optional: true }
        ),
      ]),
    ]),
  ],
})
export class BarChartComponent
  extends BaseComponent
  implements OnInit, OnChanges, OnDestroy
{
  @Output() barClick = new EventEmitter<ChartData>();
  @Input() data: ChartData[] = inject(CHART_DATA, { optional: true }) || [];
  @Input() title: string = inject(CHART_TITLE, { optional: true }) || '';
  @Input() ariaLabel: string =
    inject(CHART_ARIA_LABEL, { optional: true }) || 'Bar chart';
  @Input() chartDescription: string =
    inject(CHART_DESCRIPTION, { optional: true }) || 'Bar chart showing data';
  containerHeight: string = '200px';

  chartData: ChartData[] = [];
  maxValue: number = 0;
  yAxisLabels: number[] = [];

  // Tooltip properties
  tooltipVisible = false;
  tooltipData: TooltipData | null = null;
  tooltipX = 0;
  tooltipY = 0;

  private directionService = inject(DirectionService);

  override ngOnInit(): void {
    super.ngOnInit();
    this.directionService.direction$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.processData();
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data']) {
      this.processData();
    }
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
  }

  private processData(): void {
    if (!this.data || this.data.length === 0) {
      this.chartData = [];
      this.maxValue = 0;
      return;
    }

    const data = [...this.data];
    // Reverse the data array for RTL languages to fix the bar order
    if (this.directionService.currentDirection === 'rtl') {
      data.reverse();
    }
    this.chartData = data;

    this.calculateYAxis();
  }

  private calculateYAxis(): void {
    const dataMax = Math.max(...this.chartData.map((item) => item.value), 0);
    if (dataMax === 0) {
      this.maxValue = 0;
      this.yAxisLabels = [];
      return;
    }

    // Calculate a 'nice' round number for the max value of the axis
    const magnitude = Math.pow(10, Math.floor(Math.log10(dataMax)));
    const residual = dataMax / magnitude;
    let tick;
    if (residual > 5) {
      tick = 10;
    } else if (residual > 2) {
      tick = 5;
    } else if (residual > 1) {
      tick = 2;
    } else {
      tick = 1;
    }
    const niceMaxValue =
      Math.ceil(dataMax / ((magnitude * tick) / 4)) * ((magnitude * tick) / 4);
    this.maxValue = niceMaxValue;

    // Generate 5 labels for the Y-axis
    this.yAxisLabels = Array.from(
      { length: 5 },
      (_, i) => (niceMaxValue / 4) * i
    ).reverse();
  }

  getBarHeight(value: number): string {
    if (this.maxValue === 0) return '0%';
    const percentage = (value / this.maxValue) * 100;
    if (value === 0) return '0%';
    return `${Math.max(percentage, 3)}%`;
  }

  getBarColor(index: number): string {
    const own = this.data?.[index]?.color;
    if (typeof own === 'string' && own) return own;
    // Income first (green), then spending in the identity blue — spending is
    // normal, not an error.
    const colors = [
      'var(--mf-income)',
      'var(--mf-primary)',
      'var(--mf-cat-3)',
      'var(--mf-cat-4)',
      'var(--mf-cat-6)',
      'var(--mf-cat-8)',
    ];
    return colors[index % colors.length];
  }

  onMouseEnter(
    event: MouseEvent | FocusEvent,
    item: ChartData,
    index: number
  ): void {
    this.tooltipData = {
      label: item.name,
      value: item.value.toString(),
      color: this.getBarColor(index),
    };
    this.tooltipVisible = true;
    if (event instanceof MouseEvent) {
      this.tooltipX = event.clientX;
      this.tooltipY = event.clientY;
    } else {
      const target = event.target as HTMLElement;
      const rect = target.getBoundingClientRect();
      this.tooltipX = rect.left + rect.width / 2;
      this.tooltipY = rect.top;
    }
  }

  onMouseMove(event: MouseEvent): void {
    if (this.tooltipVisible) {
      this.tooltipX = event.clientX;
      this.tooltipY = event.clientY;
    }
  }

  onMouseLeave(): void {
    this.tooltipVisible = false;
  }

  onBarClick(item: ChartData): void {
    this.barClick.emit(item);
  }
}
