import image0 from './static/catalog/f9706dac-249e-4bdc-880e-f61f5bd79094.webp';
import image1 from './static/catalog/c993159c-251b-4214-8a53-54edea993c3d.webp';
import image2 from './static/catalog/9ec30007-1e6f-4947-a059-dac95af3c755.webp';
import image3 from './static/catalog/52042451-fa1a-4696-bd95-50eada971b2a.webp';
import image4 from './static/catalog/17e342cb-b1da-4725-a046-8a7c7bb67b52.webp';
import image5 from './static/catalog/d0a6ed00-c78c-4c69-acfb-c6c5392c6545.webp';
import image6 from './static/catalog/6478cf28-1357-4a55-9237-cbedddb3a72c.webp';
import image7 from './static/catalog/add67df6-1762-47f5-be1b-4e9b84a2df84.webp';
import image8 from './static/catalog/ce057526-f984-4ce1-9d2e-a1d452a4ed30.webp';
import image9 from './static/catalog/b27b389f-bf3d-47f1-9944-bdc55ade27fd.webp';
const thumbnails: Record<string,string> = {
  "https://app.saydian.cn/api/saydian-app/v2/files/6565a1e4-8f03-493b-9838-db60eda122a1": image0,
  "https://app.saydian.cn/api/saydian-app/v2/files/460e256e-0c54-4d66-b2ac-16bb2c5e15fb": image1,
  "https://app.saydian.cn/api/saydian-app/v2/files/1779b523-1995-414c-839b-766be4fddba9": image2,
  "https://app.saydian.cn/api/saydian-app/v2/files/f818474f-f841-44ce-8a85-c97e1fb4aa82": image3,
  "https://app.saydian.cn/api/saydian-app/v2/files/22cb23e4-7c0c-418a-8005-961900b609b6": image4,
  "https://app.saydian.cn/api/saydian-app/v2/files/1f5e734d-8c47-4b44-a4cd-fc8465e8c90a": image5,
  "http://img10.360buyimg.com/n0/jfs/t1/471910/32/6968/144141/6a486ef6F860b9037/00834e64e6323e3c.jpg": image6,
  "https://images.sursung.com/prod/item/14011274/20260731/025E520C314D422391F8DB1A48CA413B_s869434_h800_w800.png": image7,
  "http://img10.360buyimg.com/n0/jfs/t1/408997/13/14854/87331/69c79105Fccd3cf1c/008332032091049d.png": image8,
  "http://img10.360buyimg.com/n0/jfs/t1/432599/33/6327/160358/69fe9e9cF923d3ece/00833203202e37de.jpg": image9,
};
export function productThumbnail(source: string): string { return thumbnails[source] || source; }
