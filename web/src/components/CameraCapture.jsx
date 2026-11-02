import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CameraswitchIcon from '@mui/icons-material/Cameraswitch';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import AppDialog from './AppDialog';

/**
 * Кнопка «сфотографировать»: диалог камеры (getUserMedia,
 * переключение камер, фолбэк на файловый input). Снятый кадр
 * уходит в onCapture(File) — загрузкой занимается родитель.
 * В диалоге камеры есть скрепка «прикрепить фото» из памяти
 * устройства — файлы уходят в тот же onCapture.
 * Диалог не закрывается после снимка — можно фотографировать
 * серией; в заголовке в скобках — счётчик добавленных.
 */
export default function CameraCapture({
  onCapture,
  disabled = false,
  size = 'medium',
  sx,
  icon = <PhotoCameraIcon />,
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [captured, setCaptured] = useState(0);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  const emit = (file) => {
    const result = onCapture(file);
    if (result?.then) {
      result.then((ok) => {
        if (ok === false) return;
        setCaptured((c) => c + 1);
      });
    } else {
      setCaptured((c) => c + 1);
    }
  };

  const openCamera = async (mode = facingMode) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      fileInputRef.current?.click();
      return;
    }
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
      });
      streamRef.current = stream;
      setFacingMode(mode);
      setCaptured(0);
      setCameraOpen(true);
    } catch {
      fileInputRef.current?.click();
    }
  };

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          emit(new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' }));
        }
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <>
      <Tooltip title="Сфотографировать">
        <span>
          <IconButton
            color="primary"
            size={size}
            sx={sx}
            onClick={() => openCamera()}
            disabled={disabled}
          >
            {icon}
          </IconButton>
        </span>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          files.forEach((file) => emit(file));
        }}
      />

      <AppDialog open={cameraOpen} onClose={closeCamera} maxWidth="sm" fullWidth>
        <DialogTitle>
          Съёмка{captured > 0 ? ` (${captured})` : ''}
        </DialogTitle>
        <DialogContent>
          <Box
            component="video"
            ref={(el) => {
              videoRef.current = el;
              if (el && streamRef.current) el.srcObject = streamRef.current;
            }}
            autoPlay
            playsInline
            muted
            sx={{
              width: '100%',
              borderRadius: 1,
              transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
            }}
          />
        </DialogContent>
        <DialogActions>
          <Tooltip title="Переключить камеру">
            <IconButton
              onClick={() => openCamera(facingMode === 'environment' ? 'user' : 'environment')}
            >
              <CameraswitchIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Выбрать фото с устройства">
            <IconButton onClick={() => fileInputRef.current?.click()}>
              <AttachFileIcon />
            </IconButton>
          </Tooltip>
          <Button onClick={closeCamera}>Закрыть</Button>
          <Button variant="contained" startIcon={<PhotoCameraIcon />} onClick={takePhoto}>
            Снять
          </Button>
        </DialogActions>
      </AppDialog>
    </>
  );
}
