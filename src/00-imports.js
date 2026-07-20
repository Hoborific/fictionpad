import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { html } from 'htm/react';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

