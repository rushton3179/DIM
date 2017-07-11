import _ from 'underscore';
import template from './settings.html';
import './settings.scss';

export const SettingsComponent = {
  template,
  controller: SettingsController,
  controllerAs: 'vm'
};

export function SettingsController(loadingTracker, dimSettingsService, $scope, dimCsvService, dimStoreService, dimInfoService, OAuthTokenService, $state, $i18next) {
  'ngInject';

  const vm = this;

  vm.featureFlags = {
    qualityEnabled: $featureFlags.qualityEnabled,
    reviewsEnabled: $featureFlags.reviewsEnabled,
    tagsEnabled: $featureFlags.tagsEnabled,
    colorA11y: $featureFlags.colorA11y
  };
  vm.loadingTracker = loadingTracker;

  $scope.$watchCollection('vm.settings', () => {
    dimSettingsService.save();
  });

  vm.charColOptions = _.range(3, 6).map((num) => ({ id: num, name: $i18next.t('Settings.ColumnSize', { num }) }));
  vm.vaultColOptions = _.range(5, 21).map((num) => ({ id: num, name: $i18next.t('Settings.ColumnSize', { num }) }));
  vm.vaultColOptions.unshift({ id: 999, name: $i18next.t('Settings.ColumnSizeAuto') });

  vm.filters = {};

  vm.filters.vendors = {
    FWC: $i18next.t('Filter.Vendors.FWC'),
    DO: $i18next.t('Filter.Vendors.DO'),
    NM: $i18next.t('Filter.Vendors.NM'),
    Speaker: $i18next.t('Filter.Vendors.Speaker'),
    Shipwright: $i18next.t('Filter.Vendors.Shipwright'),
    CQ: $i18next.t('Filter.Vendors.CQ'),
    EV: $i18next.t('Filter.Vendors.EV'),
    Gunsmith: $i18next.t('Filter.Vendors.Gunsmith'),
  };

  vm.filters.releases = {
    Vanilla: $i18next.t('Filter.Releases.Vanilla'),
    tTK: $i18next.t('Filter.Releases.tTK'),
    RoI: $i18next.t('Filter.Releases.RoI')
  };

  vm.filters.activities = {
    QW: $i18next.t('Filter.Activities.QW'),
    IB: $i18next.t('Filter.Activities.IB'),
    VoG: $i18next.t('Filter.Activities.VoG'),
    CE: $i18next.t('Filter.Activities.CE'),
    PoE: $i18next.t('Filter.Activities.PoE'),
    ToO: $i18next.t('Filter.Activities.ToO'),
    CoE: $i18next.t('Filter.Activities.CoE'),
    KF: $i18next.t('Filter.Activities.KF'),
    SRL: $i18next.t('Filter.Activities.SRL'),
    CD: $i18next.t('Filter.Activities.CD'),
    AF: $i18next.t('Filter.Activities.AF'),
    WotM: $i18next.t('Filter.Activities.WotM'),
    Dawning: $i18next.t('Filter.Activities.Dawning'),
    AoT: $i18next.t('Filter.Activities.AoT')
  };
  vm.languageOptions = {
    de: 'Deutsch',
    en: 'English',
    es: 'Español',
    fr: 'Français',
    it: 'Italiano',
    'pt-br': 'Português (Brasil)',
    ja: '日本語'
  };

  if ($featureFlags.colorA11y) {
    vm.colorA11yOptions = ['-', 'Protanopia', 'Protanomaly', 'Deuteranopia', 'Deuteranomaly', 'Tritanopia', 'Tritanomaly', 'Achromatopsia', 'Achromatomaly'];
  }

  vm.settings = dimSettingsService;

  // Edge doesn't support these
  vm.supportsCssVar = window.CSS && window.CSS.supports && window.CSS.supports('width', 'var(--fake-var)', 0);

  vm.downloadWeaponCsv = function() {
    dimCsvService.downloadCsvFiles(dimStoreService.getStores(), "Weapons");
    ga('send', 'event', 'Download CSV', 'Weapons');
  };

  vm.downloadArmorCsv = function() {
    dimCsvService.downloadCsvFiles(dimStoreService.getStores(), "Armor");
    ga('send', 'event', 'Download CSV', 'Armor');
  };

  vm.resetHiddenInfos = function() {
    dimInfoService.resetHiddenInfos();
  };

  vm.resetItemSize = function() {
    vm.settings.itemSize = window.matchMedia('(max-width: 1025px)').matches ? 38 : 44;
  };
}
