/**
 * 相机/相册：封装 expo-image-picker
 * - 提供 launchCamera / launchLibrary
 * - 统一处理权限拒绝、用户取消、错误
 */
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
  fileSize?: number;
  mimeType?: string;
  fileName?: string;
}

async function ensurePermission(
  request: () => Promise<ImagePicker.PermissionResponse>,
  rationale: string,
): Promise<boolean> {
  const status = await request();
  if (status.granted) return true;
  if (!status.granted && rationale) {
    Alert.alert('需要权限', rationale);
  }
  return false;
}

export const cameraService = {
  async takePhoto(): Promise<PickedImage | null> {
    const ok = await ensurePermission(
      () => ImagePicker.requestCameraPermissionsAsync(),
      '请在系统设置中允许 AI Tools 访问相机',
    );
    if (!ok) return null;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.85,
      exif: false,
    });
    if (result.canceled || result.assets.length === 0) return null;
    const a = result.assets[0];
    return {
      uri: a.uri,
      width: a.width,
      height: a.height,
      fileSize: a.fileSize ?? undefined,
      mimeType: a.mimeType ?? undefined,
      fileName: a.fileName ?? undefined,
    };
  },

  async pickFromLibrary(max = 1): Promise<PickedImage[]> {
    const ok = await ensurePermission(
      () => ImagePicker.requestMediaLibraryPermissionsAsync(),
      '请在系统设置中允许 AI Tools 访问相册',
    );
    if (!ok) return [];

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: max > 1,
      selectionLimit: max,
      quality: 0.85,
    });
    if (result.canceled) return [];
    return result.assets.map((a) => ({
      uri: a.uri,
      width: a.width,
      height: a.height,
      fileSize: a.fileSize ?? undefined,
      mimeType: a.mimeType ?? undefined,
      fileName: a.fileName ?? undefined,
    }));
  },
};
