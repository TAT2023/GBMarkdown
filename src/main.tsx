import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/app.css';
import './styles/theme.css';
import './styles/titlebar.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
