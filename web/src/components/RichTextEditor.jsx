import { useEffect } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatStrikethroughIcon from '@mui/icons-material/FormatStrikethrough';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import TitleIcon from '@mui/icons-material/Title';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';

/**
 * WYSIWYG-редактор на TipTap: хранит и отдаёт HTML через onChange(html).
 * Тулбар на MUI IconButton — единый стиль приложения.
 * Картинки из буфера (Ctrl+V) и drag&drop встраиваются base64 —
 * описание задачи лежит в board_tasks.text (longText).
 * value — HTML-строка; внешнее изменение (открытие другой задачи)
 * подхватывается через setContent.
 */
const imageFiles = (files) =>
  [...(files ?? [])].filter((f) => f.type.startsWith('image/'));

const insertImages = (editor, files) => {
  const images = imageFiles(files);
  if (images.length === 0) return false;
  images.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      editor?.chain().focus()
        .setImage({ src: reader.result, alt: file.name })
        .run();
    };
    reader.readAsDataURL(file);
  });
  return true;
};

// Буфер обмена: image может лежать в items, а files быть пустым.
const clipboardImageFiles = (clipboardData) => {
  const files = imageFiles(clipboardData?.files);
  if (files.length > 0) return files;
  return [...(clipboardData?.items ?? [])]
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter(Boolean);
};

export default function RichTextEditor({
  value, onChange, placeholder, minHeight = 96, editorRef,
}) {
  const editor = useEditor({
    extensions: [StarterKit, Image],
    content: value || '',
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? '' : e.getHTML()),
    editorProps: {
      handlePaste: (_view, event) =>
        insertImages(editor, clipboardImageFiles(event.clipboardData)),
      handleDrop: (_view, event) => {
        if (insertImages(editor, event.dataTransfer?.files)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
  });

  // Родитель при сохранении читает HTML напрямую из редактора —
  // гарантия, что base64-картинки не теряются в гонках state.
  useEffect(() => {
    if (editorRef) editorRef.current = editor;
  }, [editor, editorRef]);

  // Подхват смены редактируемой записи: контент меняем только
  // если пришёл другой документ (иначе ломается позиция курсора).
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? '' : editor.getHTML();
    if ((value || '') !== current) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [editor, value]);

  const btn = (title, icon, active, action, disabled = false) => (
    <Tooltip title={title} key={title}>
      <span>
        <IconButton
          size="small"
          disabled={disabled}
          onClick={action}
          color={active ? 'primary' : 'default'}
          sx={{
            borderRadius: 0.75,
            bgcolor: active ? 'action.selected' : 'transparent',
          }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );

  const fs = { fontSize: 18 };

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        '&:focus-within': { borderColor: 'primary.main' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.25, px: 0.5, py: 0.25 }}>
        {btn('Заголовок', <TitleIcon sx={fs} />, editor?.isActive('heading', { level: 3 }),
          () => editor?.chain().focus().toggleHeading({ level: 3 }).run())}
        {btn('Жирный', <FormatBoldIcon sx={fs} />, editor?.isActive('bold'),
          () => editor?.chain().focus().toggleBold().run())}
        {btn('Курсив', <FormatItalicIcon sx={fs} />, editor?.isActive('italic'),
          () => editor?.chain().focus().toggleItalic().run())}
        {btn('Зачёркнутый', <FormatStrikethroughIcon sx={fs} />, editor?.isActive('strike'),
          () => editor?.chain().focus().toggleStrike().run())}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        {btn('Маркированный список', <FormatListBulletedIcon sx={fs} />, editor?.isActive('bulletList'),
          () => editor?.chain().focus().toggleBulletList().run())}
        {btn('Нумерованный список', <FormatListNumberedIcon sx={fs} />, editor?.isActive('orderedList'),
          () => editor?.chain().focus().toggleOrderedList().run())}
        {btn('Цитата', <FormatQuoteIcon sx={fs} />, editor?.isActive('blockquote'),
          () => editor?.chain().focus().toggleBlockquote().run())}
        <Box sx={{ flex: 1 }} />
        {btn('Отменить', <UndoIcon sx={fs} />, false,
          () => editor?.chain().focus().undo().run(), !editor?.can().undo())}
        {btn('Повторить', <RedoIcon sx={fs} />, false,
          () => editor?.chain().focus().redo().run(), !editor?.can().redo())}
      </Box>
      <Divider />
      <Box
        sx={{
          position: 'relative',
          px: 1.5,
          py: 1,
          '& .ProseMirror': {
            minHeight,
            outline: 'none',
            fontSize: '0.875rem',
            '& p': { m: 0, mb: 0.5 },
            '& ul, & ol': { pl: 3, m: 0, mb: 0.5 },
            '& blockquote': {
              borderLeft: '3px solid', borderColor: 'divider',
              m: 0, mb: 0.5, pl: 1.5, color: 'text.secondary',
            },
            '& img': {
              maxWidth: '100%', borderRadius: 1, display: 'block',
            },
          },
          '& .ProseMirror p.is-editor-empty:first-of-type::before': {
            content: 'attr(data-placeholder)',
            float: 'left', height: 0, pointerEvents: 'none',
            color: 'text.disabled',
          },
        }}
      >
        <EditorContent editor={editor} data-placeholder={placeholder} />
      </Box>
    </Box>
  );
}
