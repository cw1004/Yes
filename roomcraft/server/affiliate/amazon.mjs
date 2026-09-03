// Amazon Associates: the tracking id is a query parameter, so no API call and
// no key is needed to build a tracked link.
import { AMAZON } from '../config.mjs';

export const configured = () => Boolean(AMAZON.tag);

export async function toAffiliate(urls) {
  if (!configured()) throw new Error('AMAZON_ASSOCIATE_TAG 가 설정되지 않았습니다');
  return urls.map(u => {
    const url = new URL(u);
    url.searchParams.set('tag', AMAZON.tag);
    return url.toString();
  });
}
