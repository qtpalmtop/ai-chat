/**
 * ImageUnderstandingCard - 图片理解卡片(豆包"拍照问答"场景)
 * - 独立文件:按需加载(图片理解场景)
 */
import React from 'react';
import { Image as AntdImage, Tag } from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import type { ImageUnderstanding } from '@/types/message';

const ImageUnderstandingCardImpl: React.FC<{
  data: ImageUnderstanding;
  onPick?: (s: string) => void;
}> = ({ data, onPick }) => {
  return (
    <div className="part-img-und">
      <div className="part-img-und__head">
        <PictureOutlined /> <span>图片理解</span>
      </div>
      <div className="part-img-und__body">
        <div className="part-img-und__thumb">
          <AntdImage src={data.imageUrl} alt="uploaded" width={140} style={{ borderRadius: 8 }} />
        </div>
        <div className="part-img-und__content">
          <div className="part-img-und__desc">{data.description}</div>
          {data.tags && data.tags.length > 0 && (
            <div className="part-img-und__tags">
              {data.tags.map((t, i) => (
                <Tag key={i} color="blue" style={{ marginInlineEnd: 4 }}>
                  {t}
                </Tag>
              ))}
            </div>
          )}
        </div>
      </div>
      {data.followUpQuestions && data.followUpQuestions.length > 0 && (
        <div className="part-img-und__followup">
          {data.followUpQuestions.map((q, i) => (
            <button key={i} className="part-suggestion__chip" onClick={() => onPick?.(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageUnderstandingCardImpl;
