import {
  Component,
  ChangeDetectionStrategy,
  Input,
  OnChanges,
  SimpleChanges,
  Output,
  EventEmitter,
  inject,
  OnInit,
  OnDestroy,
  HostBinding,
  ElementRef,
  ViewChild,
} from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { formatMoney } from 'src/app/shared/utils/money-format.util';
import { BaseComponent } from 'src/app/shared/base/base.component';
import {
  ChartTooltipComponent,
  TooltipData,
} from '../../ui/chart-tooltip/chart-tooltip.component';
import {
  CHART_DATA,
  CHART_TITLE,
  CHART_ARIA_LABEL,
  CHART_SHOW_LEGEND,
  CHART_SIZE,
} from '../chart.tokens';

interface ChartData {
  name: string;
  value: number;
  [key: string]: any;
}

interface InternalChartData extends ChartData {
  visible: boolean;
}

@Component({
  selector: 'app-pie-chart',
  standalone: true,
  imports: [ChartTooltipComponent, TranslateModule],
  templateUrl: './pie-chart.component.html',
  styleUrls: ['./pie-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PieChartComponent
  extends BaseComponent
  implements OnInit, OnChanges, OnDestroy
{
  @Output() sliceClick = new EventEmitter<ChartData>();

  @Input() data: ChartData[] = inject(CHART_DATA, { optional: true }) || [];
  @Input() title: string = inject(CHART_TITLE, { optional: true }) || '';
  @Input() ariaLabel: string =
    inject(CHART_ARIA_LABEL, { optional: true }) || 'Pie chart';
  @Input() showLegend: boolean =
    inject(CHART_SHOW_LEGEND, { optional: true }) ?? true;
  @Input() size: number = inject(CHART_SIZE, { optional: true }) || 300;
  @Input() donutWidth: number = 28;
  @Input() centerLabelDefault: string = 'PROFILE.SALARY.TOTAL';
  @Input() centerSubtitleDefault: string = '';
  @Input() animationDuration = 800; // in ms

  @HostBinding('style.--chart-size') get chartSize() {
    return `${this.size}px`;
  }
  @HostBinding('style.--donut-width') get donutWidthStyle() {
    return `${this.donutWidth}px`;
  }

  @ViewChild('chartWrapper', { static: true })
  chartWrapper!: ElementRef<HTMLDivElement>;

  chartData: InternalChartData[] = [];
  slices: {
    path: string;
    color: string;
    originalIndex: number;
    percentage: number;
  }[] = [];
  legendData: { label: string; color: string; visible: boolean }[] = [];
  strokeColor: string = 'transparent';
  centerLabel: string | null = null;
  centerSubtitle: string | null = null;
  totalValue: number = 0;

  // Muted ledger palette; used only when an item has no category color.
  private colors: string[] = [
    'var(--mf-cat-1)',
    'var(--mf-cat-2)',
    'var(--mf-cat-3)',
    'var(--mf-cat-4)',
    'var(--mf-cat-5)',
    'var(--mf-cat-6)',
    'var(--mf-cat-7)',
    'var(--mf-cat-8)',
  ];

  tooltipVisible = false;
  tooltipData: TooltipData | null = null;
  tooltipX = 0;
  tooltipY = 0;

  private animationFrameId: number | null = null;

  override ngOnInit(): void {
    super.ngOnInit();
    this.updateChart(true);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] || changes['size'] || changes['donutWidth']) {
      this.updateChart(true);
    }
  }

  override ngOnDestroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    super.ngOnDestroy();
  }

  private updateChart(animate = false): void {
    if (!this.data) {
      this.chartData = [];
      this.slices = [];
      this.legendData = [];
      return;
    }

    const visibility = new Map(
      this.chartData.map((item) => [item.name, item.visible])
    );
    this.chartData = this.data
      .map((item) => ({
        ...item,
        value: Number(item.value),
        visible: visibility.get(item.name) ?? true,
      }))
      .filter((item) => Number.isFinite(item.value) && item.value >= 0);

    this.totalValue = this.chartData
      .filter((d) => d.visible)
      .reduce((sum, item) => sum + item.value, 0);
    this.updateCenterText();
    this.updateLegend();

    if (animate && this.animationDuration > 0) {
      this.animateChart();
    } else {
      this.generateSlices(1); // Draw final state immediately
    }
  }

  private animateChart(): void {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

    const startTime = performance.now();
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const animate = (currentTime: number) => {
      const elapsedTime = currentTime - startTime;
      let progress = elapsedTime / this.animationDuration;
      if (progress > 1) progress = 1;

      this.generateSlices(easeOutCubic(progress));

      this.cdr.detectChanges();

      if (progress < 1) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        this.animationFrameId = null;
      }
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  private generateSlices(progress: number): void {
    const visibleData = this.chartData.filter((item) => item.visible);
    const currentTotal = visibleData.reduce((sum, item) => sum + item.value, 0);

    if (currentTotal === 0) {
      this.slices = [];
      return;
    }

    let startAngle = -90;
    const radius = this.size / 2;
    const innerRadius = radius - this.donutWidth;

    this.slices = this.chartData.map((item, index) => {
      if (!item.visible) {
        return {
          path: '',
          color: 'transparent',
          originalIndex: index,
          percentage: 0,
        };
      }

      const sliceAngle = (item.value / currentTotal) * 360;
      const endAngle = startAngle + sliceAngle * progress; // Animate the angle

      const finalEndAngle =
        sliceAngle >= 359.99 ? startAngle + 359.99 * progress : endAngle;

      const path = this.describeArc(
        radius,
        radius,
        innerRadius,
        this.donutWidth,
        startAngle,
        finalEndAngle
      );

      const slice = {
        path: path,
        color: this.getColor(index),
        originalIndex: index,
        percentage: (item.value / currentTotal) * 100,
      };

      startAngle += sliceAngle;
      return slice;
    });
  }

  private updateLegend(): void {
    this.legendData = this.chartData.map((item, index) => ({
      label: item.name,
      color: this.getColor(index),
      visible: item.visible,
    }));
  }

  private describeArc(
    x: number,
    y: number,
    innerRadius: number,
    donutWidth: number,
    startAngle: number,
    endAngle: number
  ): string {
    if (endAngle - startAngle === 0) return '';
    const outerRadius = innerRadius + donutWidth;

    const startOuter = this.polarToCartesian(x, y, outerRadius, endAngle);
    const endOuter = this.polarToCartesian(x, y, outerRadius, startAngle);
    const startInner = this.polarToCartesian(x, y, innerRadius, endAngle);
    const endInner = this.polarToCartesian(x, y, innerRadius, startAngle);

    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

    return [
      'M',
      startOuter.x,
      startOuter.y,
      'A',
      outerRadius,
      outerRadius,
      0,
      largeArcFlag,
      0,
      endOuter.x,
      endOuter.y,
      'L',
      endInner.x,
      endInner.y,
      'A',
      innerRadius,
      innerRadius,
      0,
      largeArcFlag,
      1,
      startInner.x,
      startInner.y,
      'Z',
    ].join(' ');
  }

  private polarToCartesian(
    centerX: number,
    centerY: number,
    radius: number,
    angleInDegrees: number
  ) {
    const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
    return {
      x: centerX + radius * Math.cos(angleInRadians),
      y: centerY + radius * Math.sin(angleInRadians),
    };
  }

  getViewBox(): string {
    const margin = 8; // Margin for shadow
    return `${-margin} ${-margin} ${this.size + margin * 2} ${
      this.size + margin * 2
    }`;
  }

  getTransform(): string {
    return '';
  }

  getColor(index: number): string {
    const own = this.chartData[index]?.['color'];
    if (typeof own === 'string' && own) return own;
    return this.colors[index % this.colors.length];
  }

  private formatValue(value: number): string {
    return formatMoney(value, { showSign: false });
  }

  getAriaLabel(slice: any, index: number): string {
    if (slice.originalIndex < 0 || slice.originalIndex >= this.chartData.length)
      return '';
    const item = this.chartData[slice.originalIndex];
    return `${
      item.name
    }: ${this.formatValue(item.value)} (${slice.percentage.toFixed(1)}%)`;
  }

  toggleSeries(toggledItem: { label: string; visible: boolean }): void {
    const itemIndex = this.chartData.findIndex(
      (item) => item.name === toggledItem.label
    );
    if (itemIndex > -1) {
      this.chartData[itemIndex].visible = !this.chartData[itemIndex].visible;
      this.updateChart(true);
    }
  }

  onSliceHover(index: number): void {
    if (this.animationFrameId) return; // Disable hover during animation
    const sliceData = this.chartData[this.slices[index].originalIndex];
    if (!sliceData || !sliceData.visible) return;

    this.centerLabel = sliceData.name;
    this.centerSubtitle = this.formatValue(sliceData.value);
    this.showTooltip(index);
  }

  onSliceLeave(): void {
    if (this.animationFrameId) return;
    this.updateCenterText();
    this.hideTooltip();
  }

  private updateCenterText(): void {
    this.centerLabel = this.centerLabelDefault;
    this.centerSubtitle =
      this.totalValue > 0 ? this.formatValue(this.totalValue) : '';
  }

  showTooltip(index: number): void {
    const sliceData = this.chartData[this.slices[index].originalIndex];
    if (!sliceData || !sliceData.visible) return;

    this.tooltipVisible = true;
    this.tooltipData = {
      label: sliceData.name,
      value: sliceData.value,
      color: this.slices[index].color,
    };

    const angle = this.getSliceCenterAngle(this.slices[index].originalIndex);
    const radius = this.size / 2;
    const pos = this.polarToCartesian(radius, radius, radius * 0.7, angle);

    const chartRect = this.chartWrapper.nativeElement.getBoundingClientRect();
    this.tooltipX =
      pos.x + chartRect.left - this.chartWrapper.nativeElement.offsetLeft;
    this.tooltipY =
      pos.y + chartRect.top - this.chartWrapper.nativeElement.offsetTop;
  }

  hideTooltip(): void {
    this.tooltipVisible = false;
  }

  private getSliceCenterAngle(originalIndex: number): number {
    const visibleData = this.chartData.filter((d) => d.visible);
    const total = visibleData.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) return -90;

    let startAngle = -90;
    for (const item of visibleData) {
      const sliceAngle = (item.value / total) * 360;
      if (this.chartData[originalIndex] === item) {
        return startAngle + sliceAngle / 2;
      }
      startAngle += sliceAngle;
    }
    return -90;
  }

  onSliceClick(data: ChartData): void {
    this.sliceClick.emit(data);
  }
}
