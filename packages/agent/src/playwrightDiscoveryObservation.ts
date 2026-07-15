import type { Page } from "playwright";
import {
  createDiscoveryObservationExtractor,
  type DiscoveryObservationExtractor,
  type DiscoveryObservationExtractorDependencies,
} from "./discoveryObservation.js";
import { PlaywrightDiscoveryObservationPage } from "./playwrightDiscoveryPage.js";

export type PlaywrightDiscoveryObservationOptions = Omit<
  DiscoveryObservationExtractorDependencies,
  "page"
>;

export function createPlaywrightDiscoveryObservationExtractor(
  page: Page,
  options: PlaywrightDiscoveryObservationOptions = {},
): DiscoveryObservationExtractor {
  return createDiscoveryObservationExtractor({
    ...options,
    page: new PlaywrightDiscoveryObservationPage(page),
  });
}
