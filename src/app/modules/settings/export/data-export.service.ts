import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { catchError, firstValueFrom, of, timeout } from 'rxjs';
import { SyncService } from 'src/app/core/services/sync.service';
import { TelemetryService } from 'src/app/core/services/telemetry.service';
import { OfflineStorageService } from 'src/app/core/services/offline-storage.service';
import { ProfileService } from 'src/app/modules/profile/services/profile.service';
import { BRAND } from 'src/app/config/brand.config';
import {
  ExportOutcome,
  FileShareService,
} from './file-share.service';
import {
  ExportPeriod,
  buildExportRows,
  exportFileName,
  periodRange,
  summarize,
  toCsv,
} from './export-data.util';
import { buildPdf } from './pdf-writer';
import { renderReportPages } from './report-renderer';

export type ExportFormat = 'csv' | 'pdf';

export class NothingToExportError extends Error {
  constructor() {
    super('NOTHING_TO_EXPORT');
  }
}

@Injectable({ providedIn: 'root' })
export class DataExportService {
  private readonly offline = inject(OfflineStorageService);
  private readonly profile = inject(ProfileService);
  private readonly translate = inject(TranslateService);
  private readonly share = inject(FileShareService);
  private readonly sync = inject(SyncService);
  private readonly telemetry = inject(TelemetryService);

  /**
   * Build and hand over an export from this device's data (works offline and
   * includes records that have not synced yet). When online it first pulls the
   * latest server data.
   */
  async export(
    format: ExportFormat,
    period: ExportPeriod
  ): Promise<ExportOutcome> {
    await this.refreshFromServer();
    const rows = await this.loadRows(period);
    if (!rows.length) throw new NothingToExportError();

    const t = (key: string, params?: object): string =>
      this.translate.instant(key, params);
    const title = t('EXPORT.SHARE_TITLE');

    if (format === 'csv') {
      const csv = toCsv(rows, {
        date: t('EXPORT.COL_DATE'),
        type: t('EXPORT.COL_TYPE'),
        category: t('EXPORT.COL_CATEGORY'),
        description: t('EXPORT.COL_DESCRIPTION'),
        amount: t('EXPORT.COL_AMOUNT'),
        income: t('EXPORT.TYPE_INCOME'),
        expense: t('EXPORT.TYPE_EXPENSE'),
      });
      return this.counted(
        this.share.deliver(
          exportFileName('csv', period),
          'text/csv;charset=utf-8',
          csv,
          title
        )
      );
    }

    const lang = this.translate.currentLang || 'en';
    const pages = await renderReportPages({
      summary: summarize(rows),
      rows,
      rtl: lang.startsWith('ar'),
      currency: this.profile.getProfile()?.currency || 'USD',
      periodLabel: t(`EXPORT.PERIOD_${period.toUpperCase().replace(/-/g, '_')}`),
      generatedOn: new Date().toISOString().slice(0, 10),
      labels: {
        brand: BRAND.productName,
        title: t('EXPORT.REPORT_TITLE'),
        period: t('EXPORT.PERIOD'),
        generated: t('EXPORT.GENERATED'),
        income: t('EXPORT.TYPE_INCOME'),
        expenses: t('EXPORT.TYPE_EXPENSE'),
        net: t('EXPORT.NET'),
        byCategory: t('EXPORT.BY_CATEGORY'),
        byMonth: t('EXPORT.BY_MONTH'),
        month: t('EXPORT.MONTH'),
        transactions: t('EXPORT.TRANSACTIONS'),
        date: t('EXPORT.COL_DATE'),
        category: t('EXPORT.COL_CATEGORY'),
        description: t('EXPORT.COL_DESCRIPTION'),
        amount: t('EXPORT.COL_AMOUNT'),
        noData: t('EXPORT.NO_EXPENSES'),
        truncated: t('EXPORT.TRUNCATED'),
        page: (n, total) => t('EXPORT.PAGE_OF', { n, total }),
      },
    });
    return this.counted(
      this.share.deliver(
        exportFileName('pdf', period),
        'application/pdf',
        buildPdf(pages),
        title
      )
    );
  }

  /** Count a finished export (not one the user dismissed) for opted-in analytics. */
  private async counted(delivery: Promise<ExportOutcome>): Promise<ExportOutcome> {
    const outcome = await delivery;
    if (outcome !== 'cancelled') this.telemetry.track('export_completed');
    return outcome;
  }

  /**
   * Local data only fills through sync, so a just-signed-in device may not have
   * the full history yet. Pull the latest when online; if that fails or times
   * out, export what is on the device.
   */
  private async refreshFromServer(): Promise<void> {
    try {
      await firstValueFrom(
        this.sync.syncAll().pipe(
          timeout(20_000),
          catchError(() => of(false))
        )
      );
    } catch {
      /* offline or sync unavailable: use local data */
    }
  }

  private async loadRows(period: ExportPeriod) {
    const [expenses, categories] = await Promise.all([
      firstValueFrom(this.offline.getEntities<any>('expense')),
      firstValueFrom(this.offline.getEntities<any>('category')),
    ]);
    return buildExportRows(
      expenses,
      categories,
      periodRange(period),
      this.translate.instant('EXPORT.UNCATEGORIZED')
    );
  }
}
