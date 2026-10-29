import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BaseComponent } from 'src/app/shared/base/base.component';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { BRAND } from 'src/app/config/brand.config';
import {
  AppSettingsService,
  pickLocalized,
} from 'src/app/core/services/app-settings.service';

/** Built-in contact values, used until the dashboard configures support. */
const DEFAULT_SUPPORT = {
  email: 'support@expenses-wallet.com',
  whatsapp: '201234567890',
  website: 'https://expenses-wallet.com',
};

@Component({
  selector: 'app-help-page',
  templateUrl: './help.page.html',
  styleUrls: ['./help.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [IonicModule, TranslateModule, RouterLink],
})
export class HelpPageComponent extends BaseComponent {
  readonly brand = BRAND;
  private readonly appSettings = inject(AppSettingsService);
  private readonly lang = toSignal(this.language$, {
    initialValue: this.currentLang,
  });

  /** Dashboard values when configured, otherwise the built-in defaults. */
  readonly support = computed(() => {
    const remote = this.appSettings.support();
    const lang = this.lang();
    const website = remote?.website ?? DEFAULT_SUPPORT.website;
    return {
      email: remote?.email ?? DEFAULT_SUPPORT.email,
      whatsapp: remote?.whatsapp ?? DEFAULT_SUPPORT.whatsapp,
      website,
      websiteLabel: website.replace(/^https:\/\//, '').replace(/\/$/, ''),
      hours: pickLocalized(remote?.hours, lang),
      links: (remote?.links ?? []).map((link) => ({
        url: link.url,
        label: pickLocalized(link.label, lang) ?? new URL(link.url).hostname,
      })),
    };
  });

  private static readonly BUILT_IN_FAQS = [
    { question: 'HELP_PAGE.FAQ_1_Q', answer: 'HELP_PAGE.FAQ_1_A' },
    { question: 'HELP_PAGE.FAQ_2_Q', answer: 'HELP_PAGE.FAQ_2_A' },
    { question: 'HELP_PAGE.FAQ_3_Q', answer: 'HELP_PAGE.FAQ_3_A' },
  ];

  /** Dashboard FAQ (plain text) when configured, otherwise translated built-ins. */
  readonly faqs = computed(() => {
    const remote = this.appSettings.faq();
    if (!remote?.length) {
      return HelpPageComponent.BUILT_IN_FAQS.map((f) => ({ ...f, translated: true }));
    }
    const lang = this.lang();
    return remote.map((f) => ({
      question: pickLocalized(f.question, lang) ?? '',
      answer: pickLocalized(f.answer, lang) ?? '',
      translated: false,
    }));
  });

  ionViewWillEnter(): void {
    void this.appSettings.refresh();
  }

  openEmail() {
    window.location.href = `mailto:${this.support().email}`;
  }

  openWhatsApp() {
    window.open(`https://wa.me/${this.support().whatsapp}`, '_blank', 'noopener');
  }

  openWebsite() {
    window.open(this.support().website, '_blank', 'noopener');
  }

  openLink(url: string) {
    window.open(url, '_blank', 'noopener');
  }
}
