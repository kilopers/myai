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
    const { data } = await client.get('/api/screenshots', { params: { page: p } });
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5">Мои скриншоты</Typography>
        <Button variant="contained" component="label" startIcon={<UploadIcon />}>
          Загрузить
          <input type="file" hidden accept="image/*" onChange={onUpload} />
        </Button>
      </Box>

      {items.length === 0 ? (
        <Typography color="text.secondary">Пока пусто — сделай первый скриншот из приложения или загрузи файл.</Typography>
      ) : (
        <ImageList cols={4} gap={12}>
          {items.map((s) => (
            <ImageListItem key={s.id}>
              <Card>
                <CardMedia
                  component="img"
                  image={s.url}
                  height="160"
                  sx={{ objectFit: 'cover', cursor: 'pointer' }}
                  onClick={() => setPreview(s.url)}
                  loading="lazy"
                />
                <ImageListItemBar
                  position="below"
                  title={new Date(s.created_at).toLocaleString()}
                  actionIcon={
                    <CardActions>
                      <IconButton size="small" onClick={() => copyUrl(s.url)}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => onDelete(s.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </CardActions>
                  }
                />
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
