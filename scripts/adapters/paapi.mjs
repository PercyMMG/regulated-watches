/**
 * Adapter: Amazon Product Advertising API (PA-API 5.0).
 *
 * NOT ACTIVE. This is the compliant destination for this pipeline, kept
 * behind the same interface as the other two adapters so switching is a
 * one-line change in site.config.json rather than a rewrite.
 *
 * Why it is not active today:
 *   PA-API access requires an approved Associates account that has made
 *   at least three qualifying sales within 180 days. A new site has none,
 *   which is precisely why the saved-HTML adapter exists.
 *
 * What changes when you switch to it:
 *   - price and image come from Amazon directly, so both become
 *     redistributable under the Associates terms;
 *   - `images.mode` in site.config.json can move to "paapi";
 *   - the 24-hour price expiry still applies (PA-API terms require it);
 *   - ingestion can then run unattended on a schedule, because it is an
 *     API call rather than a page you saved.
 *
 * PA-API is free to call for approved associates, so this stays inside
 * the zero-cost constraint.
 */

export const id = 'paapi';

export function describe() {
  return {
    id,
    label: 'Product Advertising API 5.0',
    input: 'Associates credentials in env: PAAPI_ACCESS_KEY, PAAPI_SECRET_KEY, PAAPI_PARTNER_TAG.',
    sendsTraffic: true,
    active: false,
  };
}

export function extract() {
  throw new Error(
    [
      'The PA-API adapter is a stub and is not implemented.',
      '',
      'It is here so the ingestion interface does not have to change when you',
      'become eligible (3 qualifying sales in 180 days). Until then use:',
      '',
      '  npm run ingest -- --adapter html-file --file inbox/<saved-page>.html',
      '  npm run ingest -- --adapter asin-list --file inbox/asins.txt',
      '',
      'To implement it later: SearchItems / GetItems, request the resources',
      'ItemInfo.Title, ItemInfo.ByLineInfo, Offers.Listings.Price,',
      'Images.Primary.Large, CustomerReviews.StarRating, then map onto the',
      'same row shape the other adapters return:',
      '  { asin, title, brand, price, rating, rating_count, image_url, source_page }',
    ].join('\n')
  );
}
