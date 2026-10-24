import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardActions,
  CardMedia,
  Dialog,
  IconButton,
  ImageList,
  ImageListItem,
  ImageListItemBar,
  Pagination,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import UploadIcon from '@mui/icons-material/Upload';
import client from '../api/client';

export default function GalleryPage() {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async (p = 1) => {
    const { data } = await client.post('/api/action', { action: 'screenshots.state', page: p });
    if (data.state) { setItems(data.state.screenshots); setMeta(data.state.meta); return; }
    setItems(data.data);
    setMeta(data.meta);
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    await client.post('/api/screenshots', fd);
    e.target.value = '';
    load(page);
  };

  const onDelete = async (id) => {
    await client.delete(`/api/screenshots/${id}`);
    load(page);
  };

  const copyUrl = async (url) => {
    await navigator.clipboard.writeText(url);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5">Мои скриншоты</Typography>
        <Button variant="contained" component="label" startIcon={<UploadIcon />}>
          Загрузить
          <input type="file" hidden accept="image/*" onChange={onUpload} />
        </Button>
      </Box>

      {items.length === 0 ? (
        <Typography color="text.secondary">Пока пусто — сделай первый скриншот из приложения или загрузи файл.</Typography>
      ) : (
        <ImageList
          cols={8}
          gap={10}
          sx={{
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr) !important',
              sm: 'repeat(4, 1fr) !important',
              md: 'repeat(6, 1fr) !important',
              lg: 'repeat(8, 1fr) !important',
            },
          }}
        >
          {items.map((s) => (
            <ImageListItem key={s.id}>
              <Card>
                <CardMedia
                  component="img"
                  image={s.url}
                  height="130"
                  sx={{ objectFit: 'cover', cursor: 'pointer' }}
                  onClick={() => setPreview(s.url)}
                  loading="lazy"
                />
                <CardActions
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {new Date(s.created_at).toLocaleDateString()}
                    {s.expires_at && ` · до ${new Date(s.expires_at).toLocaleDateString()}`}
                  </Typography>
                  <Box sx={{ display: 'flex' }}>
                    <IconButton size="small" onClick={() => copyUrl(s.url)}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => onDelete(s.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </CardActions>
              </Card>
            </ImageListItem>
          ))}
        </ImageList>
      )}

      {meta?.last_page > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination count={meta.last_page} page={page} onChange={(_, p) => setPage(p)} />
        </Box>
      )}

      <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="xl">
        <img src={preview} alt="" style={{ maxWidth: '90vw', maxHeight: '85vh', display: 'block' }} />
      </Dialog>
    </Box>
  );
}
