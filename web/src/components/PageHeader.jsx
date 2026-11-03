import { Breadcrumbs, Box, Typography } from '@mui/material';

/**
 * Единый шаблон шапки страницы: первой строкой — хлебные крошки
 * (если есть), под ними — заголовок с действиями справа. Когда
 * крошек нет, заголовок стоит на том же месте у верхнего края.
 */
export default function PageHeader({ crumbs, title, actions }) {
  return (
    <Box sx={{ mb: 2 }}>
      {crumbs ? (
        <Breadcrumbs sx={{ mb: 1 }}>{crumbs}</Breadcrumbs>
      ) : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ flexGrow: 1, minWidth: 0 }}>
          {title}
        </Typography>
        {actions}
      </Box>
    </Box>
  );
}
