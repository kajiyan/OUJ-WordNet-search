from gensim.scripts.glove2word2vec import glove2word2vec

glove_input_file = './glove.6B.100d.txt'
word2vec_output_file = './glove.6B.100d.word2vec.txt'
glove2word2vec(glove_input_file, word2vec_output_file)