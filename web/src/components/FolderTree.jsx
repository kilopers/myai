import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  IconButton,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import HomeIcon from '@mui/icons-material/Home';
import client from '../api/client';

export const notifyFoldersChanged = () => window.dispatchEvent(new Event('folders-changed'));

/**
 * Дерево папок для сайдбара: произвольная вложенность, раскрытие
 * шевроном. Настройки папки — иконками в шапке открытой папки
 * (компонент FolderSettings).
 */
export default function FolderTree({ folders, currentFolderId, onNodeClick, onAction }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [dropTarget, setDropTarget] = useState(null); // folder.id | 'root' | null
  const [fileDragActive, setFileDragActive] = useState(false);

  // Показываем строку «В корень» и подсветку папок, пока тащат файл.
  useEffect(() => {
    const start = () => setFileDragActive(true);
    const end = () => { setFileDragActive(false); setDropTarget(null); };
    window.addEventListener('myai:file-drag', start);
    window.addEventListener('myai:file-drag-end', end);
    return () => {
      window.removeEventListener('myai:file-drag', start);
      window.removeEventListener('myai:file-drag-end', end);
    };
  }, []);

  // Дети по parent_id, отсортированные по имени
  const byParent = useMemo(() => {
    const map = new Map();
    for (const f of folders) {
      const key = f.parent_id ?? 0;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(f);
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    }
    return map;
  }, [folders]);

  // Авто-раскрытие предков текущей папки
  useEffect(() => {
    if (!currentFolderId) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let cur = folders.find((f) => f.id === currentFolderId);
      while (cur?.parent_id) {
        next.add(cur.parent_id);
        cur = folders.find((f) => f.id === cur.parent_id);
      }
      return next;
    });
  }, [currentFolderId, folders]);

  // Drag&drop: карточка файла из списка — на папку дерева (перемещение).
  const isFileDrag = (e) => e.dataTransfer.types?.includes('application/x-myai-file');

  const dropProps = (key) => ({
    onDragOver: (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
    onDrop: async (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setDropTarget(null);
      const id = Number(e.dataTransfer.getData('application/x-myai-file'));
      if (!id) return;
      try {
        await client.post('/api/action', {
          action: 'files.move',
          id,
          folder_id: key === 'root' ? null : key,
        });
        window.dispatchEvent(new Event('files-changed'));
        notifyFoldersChanged();
      } catch {
        onAction?.('Не удалось переместить файл');
      }
    },
  });

  const renderNode = (folder, depth) => {
    const children = byParent.get(folder.id) ?? [];
    const isOpen = expanded.has(folder.id);
    const selected = folder.id === currentFolderId;

    return (
      <Box key={folder.id}>
        <ListItemButton
          selected={selected}
          onClick={() => onNodeClick(folder)}
          {...dropProps(folder.id)}
          sx={{
            borderRadius: 1.5,
            py: 0.3,
            pl: `${8 + depth * 14}px`,
            pr: 0.5,
            mb: 0.125,
            color: 'rgb(148, 133, 113)',
            '&:hover': { bgcolor: 'rgb(243, 231, 211)' },
            '&.Mui-selected': {
              bgcolor: 'rgb(243, 231, 211)',
              color: 'rgb(176, 95, 56)',
              '&:hover': { bgcolor: 'rgb(243, 231, 211)' },
              '& .MuiListItemIcon-root': { color: 'rgb(176, 95, 56)' },
            },
            ...(dropTarget === folder.id && {
              outline: '2px dashed rgb(176, 95, 56)',
              bgcolor: 'rgb(243, 231, 211)',
            }),
          }}
        >
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => {
                const next = new Set(prev);
                next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id);
                return next;
              });
            }}
            sx={{
              mr: 0.25,
              p: 0.25,
              visibility: children.length ? 'visible' : 'hidden',
              '& svg': { fontSize: 16 },
            }}
          >
            {isOpen ? <ExpandMoreIcon /> : <ChevronRightIcon />}
          </IconButton>
          <ListItemIcon sx={{ minWidth: 26, color: 'rgb(148, 133, 113)', '& svg': { fontSize: 18 } }}>
            <FolderIcon />
          </ListItemIcon>
          <ListItemText
            primary={folder.name}
            primaryTypographyProps={{
              fontSize: '14px',
              noWrap: true,
              fontWeight: selected ? 600 : 400,
            }}
          />
        </ListItemButton>
        {isOpen && children.map((c) => renderNode(c, depth + 1))}
      </Box>
    );
  };

  return (
    <>
      <Box sx={{ px: 0.5 }}>
        {fileDragActive && (
          <ListItemButton
            {...dropProps('root')}
            sx={{
              borderRadius: 1.5,
              py: 0.3,
              pl: '8px',
              mb: 0.125,
              color: 'rgb(148, 133, 113)',
              border: '1px dashed #cfc2a9',
              ...(dropTarget === 'root' && { borderColor: 'rgb(176, 95, 56)', bgcolor: 'rgb(243, 231, 211)' }),
            }}
          >
            <ListItemIcon sx={{ minWidth: 26, color: 'rgb(148, 133, 113)', '& svg': { fontSize: 18 } }}>
              <HomeIcon />
            </ListItemIcon>
            <ListItemText
              primary="В корень"
              primaryTypographyProps={{ fontSize: '14px', noWrap: true }}
            />
          </ListItemButton>
        )}
        {(byParent.get(0) ?? []).map((f) => renderNode(f, 0))}
      </Box>

    </>
  );
}
