/**
 * ImageGroupCard - 图片组(多图轮播)
 * - 独立文件:按需加载
 */
import React from 'react';
import { Image as AntdImage } from 'antd';
import type { ImageGroup } from '@/types/message';

const ImageGroupCardImpl: React.FC<{ data: ImageGroup }> = ({ data }) => {
  if (!data?.images?.length) return null;
  return (
    <div className="part-image-group">
      {data.images.map((img, i) => (
        <div key={i} className="part-image-group__item">
          <AntdImage src={img.url} alt={img.alt} width={120} style={{ borderRadius: 6 }} />
          {img.caption && <div className="part-image-group__caption">{img.caption}</div>}
        </div>
      ))}
    </div>
  );
};

export default ImageGroupCardImpl;
